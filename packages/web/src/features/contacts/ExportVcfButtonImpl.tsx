import React, { useState } from 'react';
import type { ExportVcfButtonProps } from '../../contracts/contacts-ui';
import { useToast } from '../../providers';
import { Button } from '../../ui';
import { shareOrDownloadVCard } from './vcard';

export function ExportVcfButtonImpl({
  contact,
  variant = 'secondary',
  disabled = false,
  testId,
  className,
  onExported,
  ...rest
}: ExportVcfButtonProps): React.JSX.Element {
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const resolvedTestId = rest['data-testid'] ?? testId ?? 'export-vcf-btn';
  const btnSize = variant === 'icon' ? 'icon' : 'compact';

  const hasNameOrPhone =
    Boolean(contact?.fullName?.trim()) || Boolean(contact?.phone?.trim());
  const isDisabled = disabled || isExporting || !hasNameOrPhone;

  const targetLabel =
    contact?.fullName?.trim() || contact?.phone?.trim() || 'ce client';

  const handleClick = async (): Promise<void> => {
    if (isDisabled) return;
    setIsExporting(true);
    try {
      const result = await shareOrDownloadVCard({
        fullName: contact.fullName,
        phone: contact.phone,
        contextOrRelay: contact.contextOrRelay,
        notes: contact.notes,
      });

      if (result.method === 'aborted') {
        return;
      }

      onExported?.(result.method);
      toast.success(
        result.method === 'share'
          ? `Fiche contact « ${targetLabel} » partagée.`
          : `Fiche contact « ${result.fileName} » téléchargée.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Impossible d'exporter la fiche contact .vcf.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size={btnSize}
      disabled={isDisabled}
      data-testid={resolvedTestId}
      aria-label={`Exporter la fiche contact de ${targetLabel} en .vcf`}
      className={className}
      onClick={() => void handleClick()}
    >
      {variant === 'icon' ? '.vcf' : 'Exporter .vcf'}
    </Button>
  );
}
