import type { Attachment } from '@prisma/client';

export function attachmentDto(a: Pick<Attachment, 'id' | 'originalName' | 'mimeType' | 'sizeBytes' | 'createdAt' | 'settlementId'>) {
  return { id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt, settlementId: a.settlementId };
}
