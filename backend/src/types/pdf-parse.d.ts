declare module 'pdf-parse' {
  function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number; numrender: number; info: Record<string, unknown>; metadata: Record<string, unknown> }>;
  export default pdfParse;
}
