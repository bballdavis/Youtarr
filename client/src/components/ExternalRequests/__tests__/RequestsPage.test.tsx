import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RequestsPage from '../RequestsPage';
import { ExternalRequestReview } from '../../../types/externalRequest';

const requestId = '9b89e5bc-8c90-4e72-b245-270fed2eacc2';
const pendingRequest = {
  id: requestId,
  type: 'video' as const,
  status: 'pending' as const,
  requester: {
    id: 4,
    name: 'External Client',
    keyPrefix: 'abcd1234',
    role: 'request',
    isActive: true,
    revokedAt: null,
  },
  target: {
    youtubeId: 'abcdefghijk',
    channelId: 8,
    youtubeChannelId: 'UC1234567890123456789012',
    channelTitle: 'Safe Channel',
    title: 'Safe video',
    mediaType: 'video',
    rating: 'TV-PG',
    contentRating: 'TV-Y',
  },
  job: null,
  createdAt: '2026-07-26T12:00:00.000Z',
  updatedAt: '2026-07-26T12:00:00.000Z',
};

const page = (data: ExternalRequestReview[] = [pendingRequest]) => ({
  data,
  pagination: { page: 1, pageSize: 25, total: data.length, totalPages: data.length ? 1 : 0 },
  filterOptions: { requesters: [pendingRequest.requester] },
});

const jsonResponse = (body: unknown, ok = true) => Promise.resolve({
  ok,
  json: async () => body,
} as Response);

const renderPage = () => render(
  <MemoryRouter initialEntries={['/requests']}>
    <RequestsPage token="session-token" />
  </MemoryRouter>
);

describe('RequestsPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test('loads the queue, opens details, confirms approval, and refreshes status', async () => {
    const processing = {
      ...pendingRequest,
      status: 'processing' as const,
      job: {
        id: requestId,
        status: 'In Progress',
        type: 'External video request',
        createdAt: pendingRequest.createdAt,
        startedAt: pendingRequest.createdAt,
      },
    };
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page()))
      .mockImplementationOnce(() => jsonResponse(pendingRequest))
      .mockImplementationOnce(() => jsonResponse(processing))
      .mockImplementationOnce(() => jsonResponse(page([processing])));

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Safe video')).toBeInTheDocument();
    expect(screen.getByText('External Client')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage API keys' }))
      .toHaveAttribute('href', '/settings/api-keys');
    expect(screen.getByRole('img', { name: 'Safe video thumbnail' }))
      .toHaveAttribute('src', 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Request details')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/external-requests/${requestId}/approve`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': 'session-token',
          },
          body: '{}',
        })
      );
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/external-requests?'),
      expect.objectContaining({
        headers: { 'x-access-token': 'session-token' },
      })
    );
  });

  test('shows empty and retryable error states', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse({ error: 'Unable to read request queue' }, false))
      .mockImplementationOnce(() => jsonResponse(page([])));

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Unable to read request queue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No requests match these filters.')).toBeInTheDocument();
  });

  test('requires a rejection reason before submission', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page()))
      .mockImplementationOnce(() => jsonResponse(pendingRequest));

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Not approved' } });
    expect(confirm).toBeEnabled();
  });

  test('reviews channel requests and sends the grant decision', async () => {
    const channelRequest: ExternalRequestReview = {
      ...pendingRequest,
      type: 'channel',
      target: {
        youtubeId: null,
        channelId: null,
        channelUrl: 'https://www.youtube.com/@safechannel',
        youtubeChannelId: null,
        channelTitle: null,
        title: null,
        mediaType: null,
        rating: null,
      },
    };
    const completed = {
      ...channelRequest,
      status: 'completed' as const,
      target: {
        ...channelRequest.target,
        channelId: 12,
        youtubeChannelId: 'UC1234567890123456789012',
        channelTitle: 'Safe Channel',
        rating: 'TV-PG',
      },
    };
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page([channelRequest])))
      .mockImplementationOnce(() => jsonResponse(channelRequest))
      .mockImplementationOnce(() => jsonResponse(completed))
      .mockImplementationOnce(() => jsonResponse(page([completed])));

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Details' }));
    expect(screen.getAllByText('@safechannel').length).toBeGreaterThan(0);
    expect(screen.queryByText('https://www.youtube.com/@safechannel')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open channel' }))
      .toHaveAttribute('href', 'https://www.youtube.com/@safechannel');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByLabelText(
      'Grant the provisioned channel to the requesting key'
    ));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      `/api/external-requests/${requestId}/approve`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ grantToRequestingKey: false }),
      })
    ));
  });

  test('renders compact request metadata and starts approval from the review column', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page()))
      .mockImplementationOnce(() => jsonResponse({ ...pendingRequest, status: 'processing' }))
      .mockImplementationOnce(() => jsonResponse(page([{ ...pendingRequest, status: 'processing' }])));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Safe video');
    const requestCell = screen.getByTestId(`request-summary-${requestId}`);
    const cell = within(requestCell);
    expect(cell.getByText('Downloaded')).toBeInTheDocument();
    expect(cell.getAllByText('TV-Y').length).toBeGreaterThan(0);
    expect(cell.getAllByText('Safe Channel').length).toBeGreaterThan(0);

    expect(screen.getByRole('button', { name: 'Details' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Approve request' }));
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/external-requests/${requestId}/approve`,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  test('keeps review controls aligned but disables decisions for a completed request', async () => {
    const completed = { ...pendingRequest, status: 'completed' as const };
    (global.fetch as jest.Mock).mockImplementationOnce(() => jsonResponse(page([completed])));

    renderPage();

    expect(await screen.findByRole('button', { name: 'Details' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeDisabled();
  });

  test('ignores an obsolete details response after starting an inline action', async () => {
    const other = {
      ...pendingRequest,
      id: '8b89e5bc-8c90-4e72-b245-270fed2eacc2',
      target: { ...pendingRequest.target, title: 'Other video' },
    };
    let resolveDetails!: (response: Response) => void;
    const deferredDetails = new Promise<Response>((resolve) => { resolveDetails = resolve; });
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page([pendingRequest, other])))
      .mockImplementationOnce(() => deferredDetails)
      .mockImplementationOnce(() => jsonResponse({ ...other, status: 'approved' }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Other video');
    await user.click(within(screen.getByTestId(`request-card-${requestId}`)).getByRole('button', { name: 'Details' }));
    await user.click(within(screen.getByRole('dialog')).getByText('Close', { selector: 'button' }));
    await user.click(within(screen.getByTestId(`request-card-${other.id}`)).getByRole('button', { name: 'Approve request' }));
    resolveDetails({ ok: true, json: async () => pendingRequest } as Response);
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      `/api/external-requests/${other.id}/approve`, expect.objectContaining({ method: 'POST' })
    ));
  });
});
