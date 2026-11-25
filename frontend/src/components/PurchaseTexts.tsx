import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ExpandableText from './ExpandableText';

interface Props {
  /** The purchase's one description (request / quotation / PO notes). */
  description?: string | null;
  /** Free text typed as the PO's payment terms. */
  paymentTerms?: string | null;
  /** The request's terms / technical requirements. */
  requirements?: string | null;
  variant?: 'body2' | 'caption';
  color?: string;
}

const has = (v?: string | null) => !!v && v.trim().length > 0;

/**
 * Everything a person typed about a purchase, for the outside (list) view: the
 * description, then the payment terms and requirements, each with "See more"
 * when long. Renders nothing when there is nothing to show.
 */
export default function PurchaseTexts({ description, paymentTerms, requirements, variant = 'body2', color }: Props) {
  const { t } = useTranslation();
  if (!has(description) && !has(paymentTerms) && !has(requirements)) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
      <ExpandableText text={description} variant={variant} color={color} />
      <ExpandableText text={paymentTerms} label={t('common.paymentTerms')} variant={variant} color={color} />
      <ExpandableText text={requirements} label={t('common.requirements')} variant={variant} color={color} />
    </Box>
  );
}
