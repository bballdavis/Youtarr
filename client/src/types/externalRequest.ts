export type ExternalRequestStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface ExternalRequestRequester {
  id: number;
  name: string;
  keyPrefix: string;
  role: string;
  isActive: boolean;
  revokedAt: string | null;
}

export interface ExternalRequestReview {
  id: string;
  type: 'video';
  status: ExternalRequestStatus;
  requester: ExternalRequestRequester | null;
  target: {
    youtubeId: string;
    channelId: number;
    youtubeChannelId: string | null;
    channelTitle: string | null;
    title: string | null;
    mediaType: string | null;
  };
  job: {
    id: string;
    status: string;
    type: string;
    createdAt: string;
    startedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface ExternalRequestReviewPage {
  data: ExternalRequestReview[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filterOptions: {
    requesters: ExternalRequestRequester[];
  };
}
