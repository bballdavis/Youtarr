import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    render(<RequestsPage token="session-token" />);

    expect(await screen.findByText('Safe video')).toBeInTheDocument();
    expect(screen.getByText('External Client')).toBeInTheDocument();
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
    render(<RequestsPage token="session-token" />);

    expect(await screen.findByText('Unable to read request queue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No requests match these filters.')).toBeInTheDocument();
  });

  test('requires a rejection reason before submission', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => jsonResponse(page()))
      .mockImplementationOnce(() => jsonResponse(pendingRequest));

    const user = userEvent.setup();
    render(<RequestsPage token="session-token" />);
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Not approved' } });
    expect(confirm).toBeEnabled();
  });
});
