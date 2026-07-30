import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContentBody,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  IconButton,
} from '../ui';
import {
  ExternalRequestRequester,
  ExternalRequestReview,
  ExternalRequestReviewPage,
  ExternalRequestStatus,
} from '../../types/externalRequest';
import { Download, Info, ThumbsDown, ThumbsUp } from 'lucide-react';
import RatingBadge from '../shared/RatingBadge';

const STATUSES: ExternalRequestStatus[] = [
  'pending',
  'approved',
  'processing',
  'completed',
  'rejected',
  'failed',
  'cancelled',
];

const statusColor = (status: ExternalRequestStatus) => {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'error';
  if (status === 'processing' || status === 'approved') return 'info';
  return 'warning';
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

interface RequestsPageProps {
  token: string;
}

type ReviewAction = 'approve' | 'reject';

const RequestsPage: React.FC<RequestsPageProps> = ({ token }) => {
  const [requests, setRequests] = useState<ExternalRequestReview[]>([]);
  const [requesters, setRequesters] = useState<ExternalRequestRequester[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExternalRequestReview | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const detailRequestRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (status) params.set('status', status);
    if (apiKeyId) params.set('apiKeyId', apiKeyId);
    try {
      const response = await fetch(`/api/external-requests?${params}`, {
        headers: { 'x-access-token': token },
        signal,
      });
      const body = await response.json().catch(() => null) as ExternalRequestReviewPage | { error?: string } | null;
      if (!response.ok || !body || !('data' in body)) {
        throw new Error(body && 'error' in body && body.error
          ? body.error
          : 'Unable to load requests');
      }
      setRequests(body.data);
      setRequesters(body.filterOptions.requesters);
      setTotalPages(body.pagination.totalPages);
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load requests');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiKeyId, page, reloadToken, status, token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openDetail = async (request: ExternalRequestReview) => {
    const requestSequence = ++detailRequestRef.current;
    setSelected(request);
    setDetailLoading(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/external-requests/${request.id}`, {
        headers: { 'x-access-token': token },
      });
      const body = await response.json().catch(() => null) as ExternalRequestReview | { error?: string } | null;
      if (!response.ok || !body || !('status' in body)) {
        throw new Error(body && 'error' in body && body.error
          ? body.error
          : 'Unable to load request details');
      }
      if (requestSequence === detailRequestRef.current) setSelected(body);
    } catch (detailError) {
      if (requestSequence === detailRequestRef.current) {
        setActionError(detailError instanceof Error
          ? detailError.message
          : 'Unable to load request details');
      }
    } finally {
      if (requestSequence === detailRequestRef.current) setDetailLoading(false);
    }
  };

  const submitAction = async () => {
    if (!selected || !action) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/external-requests/${selected.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': token,
        },
        body: JSON.stringify(action === 'reject' ? { reason } : {}),
      });
      const body = await response.json().catch(() => null) as ExternalRequestReview | { error?: string } | null;
      if (!response.ok || !body || !('status' in body)) {
        throw new Error(body && 'error' in body && body.error
          ? body.error
          : `Unable to ${action} request`);
      }
      setSelected(body);
      setAction(null);
      setReason('');
      setReloadToken((value) => value + 1);
    } catch (reviewError) {
      setActionError(reviewError instanceof Error
        ? reviewError.message
        : `Unable to ${action} request`);
    } finally {
      setSubmitting(false);
    }
  };

  const beginInlineAction = (request: ExternalRequestReview, nextAction: ReviewAction) => {
    if (submitting || request.status !== 'pending') return;
    ++detailRequestRef.current;
    setDetailLoading(false);
    setSelected(request);
    setActionError(null);
    setReason('');
    setAction(nextAction);
  };

  const closeDetails = () => {
    ++detailRequestRef.current;
    setSelected(null);
    setAction(null);
    setDetailLoading(false);
  };

  const metadata = (request: ExternalRequestReview) => (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Chip
        label="Downloaded"
        size="small"
        variant="outlined"
        icon={<Download size={12} aria-hidden="true" />}
      />
      <RatingBadge rating={request.target.contentRating} showNA size="small" />
      <span className="text-muted-foreground">{request.target.channelTitle || `Channel ${request.target.channelId}`}</span>
    </div>
  );

  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  const changeRequester = (value: string) => {
    setApiKeyId(value);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Typography variant="h5">External Requests</Typography>
        <Typography variant="body2" color="secondary">
          Review video requests submitted by approved external clients.
        </Typography>
      </div>

      <Card variant="outlined">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[190px]">
              <Typography variant="caption" color="secondary">Status</Typography>
              <Select
                value={status}
                onValueChange={changeStatus}
                fullWidth
                size="small"
                inputProps={{ 'aria-label': 'Filter by status' }}
              >
                <MenuItem value="">All statuses</MenuItem>
                {STATUSES.map((value) => (
                  <MenuItem key={value} value={value}>{value}</MenuItem>
                ))}
              </Select>
            </div>
            <div className="min-w-[230px]">
              <Typography variant="caption" color="secondary">Requester</Typography>
              <Select
                value={apiKeyId}
                onValueChange={changeRequester}
                fullWidth
                size="small"
                inputProps={{ 'aria-label': 'Filter by requester' }}
              >
                <MenuItem value="">All requesters</MenuItem>
                {requesters.map((requester) => (
                  <MenuItem key={requester.id} value={String(requester.id)}>
                    {requester.name} ({requester.keyPrefix})
                  </MenuItem>
                ))}
              </Select>
            </div>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setReloadToken((value) => value + 1)}
              disabled={loading}
              className="self-end"
            >
              Refresh
            </Button>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-3 py-12" role="status">
              <CircularProgress size={24} />
              <Typography variant="body2">Loading requests…</Typography>
            </div>
          )}

          {!loading && error && (
            <Alert severity="error">
              <div className="space-y-2">
                <Typography variant="body2">{error}</Typography>
                <Button size="small" variant="outlined" onClick={() => setReloadToken((value) => value + 1)}>
                  Retry
                </Button>
              </div>
            </Alert>
          )}

          {!loading && !error && requests.length === 0 && (
            <div className="py-12 text-center">
              <Typography variant="body1">No requests match these filters.</Typography>
              <Typography variant="body2" color="secondary">
                New video requests will appear here for review.
              </Typography>
            </div>
          )}

          {!loading && !error && requests.length > 0 && (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell component="th">Status</TableCell>
                    <TableCell component="th">Request</TableCell>
                    <TableCell component="th">Requester</TableCell>
                    <TableCell component="th">Submitted</TableCell>
                    <TableCell component="th" align="right">Review</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id} hover>
                      <TableCell>
                        <Chip
                          label={request.status}
                          color={statusColor(request.status)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px]" data-testid={`request-summary-${request.id}`}>
                          <div className="font-medium truncate">
                            {request.target.title || request.target.youtubeId}
                          </div>
                          {metadata(request)}
                        </div>
                      </TableCell>
                      <TableCell>{request.requester?.name || 'Unavailable key'}</TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton size="small" title="View request details" aria-label="Details" onClick={() => void openDetail(request)}>
                            <Info size={16} />
                          </IconButton>
                          <IconButton size="small" title="Approve request" aria-label="Approve request" color="success" disabled={request.status !== 'pending' || submitting} onClick={() => beginInlineAction(request, 'approve')}>
                            <ThumbsUp size={16} />
                          </IconButton>
                          <IconButton size="small" title="Reject request" aria-label="Reject request" color="error" disabled={request.status !== 'pending' || submitting} onClick={() => beginInlineAction(request, 'reject')}>
                            <ThumbsDown size={16} />
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {!loading && !error && totalPages > 1 && (
            <div className="flex items-center justify-end gap-3">
              <Button
                size="small"
                variant="outlined"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <Typography variant="body2">Page {page} of {totalPages}</Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selected !== null && action === null}
        onClose={closeDetails}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle onClose={closeDetails}>Request details</DialogTitle>
        <DialogContentBody>
          {detailLoading && (
            <div className="flex justify-center py-8" role="status">
              <CircularProgress size={24} />
            </div>
          )}
          {selected && !detailLoading && (
            <div className="space-y-4">
              {actionError && <Alert severity="error">{actionError}</Alert>}
              <div className="flex flex-wrap items-center gap-2">
                <Chip label={selected.status} color={statusColor(selected.status)} size="small" />
                {metadata(selected)}
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="font-medium">Video</dt>
                <dd>{selected.target.title || selected.target.youtubeId}</dd>
                <dt className="font-medium">YouTube ID</dt>
                <dd className="break-all">{selected.target.youtubeId}</dd>
                <dt className="font-medium">Channel</dt>
                <dd>{selected.target.channelTitle || `Channel ${selected.target.channelId}`}</dd>
                <dt className="font-medium">Requester</dt>
                <dd>
                  {selected.requester
                    ? `${selected.requester.name} (${selected.requester.keyPrefix})`
                    : 'Unavailable key'}
                </dd>
                <dt className="font-medium">Submitted</dt>
                <dd>{formatDate(selected.createdAt)}</dd>
                <dt className="font-medium">Last updated</dt>
                <dd>{formatDate(selected.updatedAt)}</dd>
                {selected.job && (
                  <>
                    <dt className="font-medium">Download job</dt>
                    <dd>{selected.job.status} · {selected.job.id}</dd>
                  </>
                )}
                {selected.message && (
                  <>
                    <dt className="font-medium">Message</dt>
                    <dd>{selected.message}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </DialogContentBody>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={closeDetails}>Close</Button>
          {selected?.status === 'pending' && !detailLoading && (
            <>
              <Button variant="outlined" color="error" onClick={() => {
                setReason('');
                setActionError(null);
                setAction('reject');
              }}>
                Reject
              </Button>
              <Button variant="contained" color="primary" onClick={() => {
                setActionError(null);
                setAction('approve');
              }}>
                Approve
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={selected !== null && action !== null}
        onClose={() => !submitting && setAction(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm {action === 'approve' ? 'approval' : 'rejection'}
        </DialogTitle>
        <DialogContentBody className="space-y-4">
          <DialogContentText>
            {action === 'approve'
              ? 'Youtarr will recheck the requester, channel grant, catalog entry, media type, and rating policy before accepting the download.'
              : 'Rejecting this request is final. The client may submit a new request later.'}
          </DialogContentText>
          {action === 'reject' && (
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              inputProps={{ maxLength: 300 }}
              helperText={`${reason.trim().length}/300 characters`}
              multiline
              rows={3}
              fullWidth
              required
            />
          )}
          {actionError && <Alert severity="error">{actionError}</Alert>}
        </DialogContentBody>
        <DialogActions>
          <Button variant="outlined" color="inherit" disabled={submitting} onClick={() => setAction(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={action === 'reject' ? 'error' : 'primary'}
            disabled={submitting || (action === 'reject' && reason.trim().length === 0)}
            loading={submitting}
            onClick={() => void submitAction()}
          >
            Confirm {action === 'approve' ? 'approval' : 'rejection'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default RequestsPage;
