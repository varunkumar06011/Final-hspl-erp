Feature: OCR Document Scanning — Auto-Fill from Photos
  As a supervisor
  I want to photograph a vendor's paper quotation or invoice and have the app automatically extract the details
  So that I don't have to manually type in every line item, amount, and vendor name

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the Groq vision API is configured with a valid API key
    And the OCR service supports images (JPG, PNG, GIF) and PDFs

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Scan a paper quotation — line items are extracted
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor photographs a cement quotation and the app auto-fills the line items
    When Ravi goes to "Create Quotation" and taps "Scan Quotation"
    And photographs the paper quotation
    Then the app sends the photo to the OCR endpoint
    And the Groq vision model extracts the following:
      | vendorName       | Ultra Cement Supplies     |
      | quotationNumber  | Q-2026-045                |
      | date             | 2026-08-23                |
      | lineItems        | 3 items (OPC Cement, PPC Cement, White Cement) |
      | gstAmount        | 6840                      |
      | totalAmount      | 38000                     |
      | grandTotal       | 44840                     |
    And the app pre-fills the quotation form with these values
    And Ravi reviews the pre-filled form and clicks "Submit"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Scan a vendor invoice — amounts are extracted
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor photographs a vendor invoice and the app auto-fills the amounts
    When Ravi goes to "Create Invoice" and taps "Scan Invoice"
    And photographs the paper invoice
    Then the Groq vision model extracts:
      | vendorName      | Ultra Cement Supplies     |
      | invoiceNumber   | INV-2026-001              |
      | date            | 2026-08-23                |
      | amount          | 38000                     |
      | taxAmount       | 6840                      |
      | totalAmount     | 44840                     |
      | deliveryDate    | 2026-08-25                |
    And the app pre-fills the invoice form

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Scan a PDF quotation (multi-page)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a 3-page PDF quotation
    When Ravi uploads a PDF file "quotation.pdf" (3 pages)
    Then the OCR service renders each page to an image using pdfjs
    And sends all 3 page images to the Groq vision model
    And the model extracts line items from all pages
    And the app pre-fills the form with all extracted items

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Unsupported file type is rejected
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a Word document by mistake
    When Ravi uploads a file "quotation.docx" with MIME type "application/vnd.openxmlformats"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Unsupported file type. Please upload an image (JPG/PNG) or PDF."
    And the app shows a helpful message telling Ravi to take a photo instead

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Groq API key is not configured
  # ─────────────────────────────────────────────────────────────────
  Scenario: OCR is attempted but GROQ_API_KEY is missing from the backend .env
    Given the GROQ_API_KEY environment variable is not set
    When Ravi tries to scan a quotation
    Then the backend responds with HTTP 500
    And the error message says "GROQ_API_KEY is not configured"
    And the app shows "OCR is not available — please enter the details manually"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Model wraps JSON in markdown code fences
  # ─────────────────────────────────────────────────────────────────
  Scenario: Groq model returns JSON wrapped in ```json fences — the app still parses it
    When the Groq model responds with:
      """
      ```json
      {"vendorName": "Acme", "lineItems": [{"materialName": "Cement", "quantity": 10, "unitPrice": 380}]}
      ```
      """
    Then the OCR service strips the markdown fences
    And parses the JSON successfully
    And the app pre-fills the form with vendor "Acme" and 1 line item

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Model can't read some fields — they're filled as null
  # ─────────────────────────────────────────────────────────────────
  Scenario: Quotation photo is blurry — model can read items but not the total
    When the Groq model responds with vendorName=null, lineItems=[...], grandTotal=null
    Then the OCR service returns null for the unreadable fields
    And the app shows "Could not read" in the total amount field
    And Ravi manually enters the total amount
    And the line items that were readable are still pre-filled

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Groq API rate limit (429)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Too many OCR requests — Groq returns 429 Rate Limited
    When the Groq API responds with HTTP 429
    Then the backend throws an error "Groq API error 429: rate limited"
    And the app shows "OCR service is busy — please try again in a moment"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Corrupt PDF file
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a file renamed to .pdf but it's actually a JPEG
    When Ravi uploads a file "scan.pdf" that is actually a JPEG image renamed to .pdf
    Then the pdfjs library fails to parse it
    And the backend responds with a friendly error: "Failed to read PDF. Try uploading a photo/screenshot instead."
    And the app suggests Ravi take a photo with the camera instead

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Large image is compressed before sending to Groq
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a 12MP photo from their phone camera
    When Ravi uploads a 12MB JPG image
    Then the OCR service uses sharp to resize it to max 1600px width
    And compresses it to JPEG quality 85
    And the compressed image is sent to Groq (staying within the 10MB API limit)
    And the extraction works the same as with a smaller image
