import type { CustomerDirectoryEntry, CustomerSuggestion } from '@app-icol/shared';

export type { CustomerDirectoryEntry, CustomerSuggestion };

export interface CustomerDraftFields {
  customerName: string;
  phone: string;
  contextOrRelay: string;
}

export interface CustomerPickerProps {
  value: CustomerDraftFields;
  onChange: (next: CustomerDraftFields) => void;
  suggestions?: CustomerSuggestion[];
  relaySuggestions?: string[];
  disabled?: boolean;
  errorMessage?: string;
}

export interface ExportVcfButtonProps {
  contact: {
    fullName: string;
    phone: string;
    contextOrRelay?: string;
    notes?: string;
  };
  variant?: 'icon' | 'compact' | 'secondary';
  disabled?: boolean;
  testId?: string;
  'data-testid'?: string;
  className?: string;
  onExported?: (method: 'share' | 'download') => void;
}
