import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { http, HttpResponse } from 'msw';
import ApiKeysSection from '../ApiKeysSection';

const meta: Meta<typeof ApiKeysSection> = {
  title: 'Components/Configuration/Sections/ApiKeysSection',
  component: ApiKeysSection,
  args: {
    token: 'storybook-token',
    apiKeyRateLimit: 10,
    onRateLimitChange: () => {},
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/keys', () => HttpResponse.json({ keys: [] })),
      ],
    },
  },
};

export default meta;
type Story = StoryObj<typeof ApiKeysSection>;

export const OpensCreateDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /create key/i }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Create API Key')).toBeInTheDocument();
  },
};

export const ResponsiveKeyCards: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    msw: {
      handlers: [
        http.get('/api/keys', () => HttpResponse.json({
          keys: [{
            id: 4,
            name: 'External Client Family Room',
            key_prefix: 'external-client123',
            created_at: '2026-07-27T18:30:00.000Z',
            last_used_at: '2026-07-27T19:00:00.000Z',
            is_active: true,
            usage_count: 12,
            role: 'delete',
            auto_approve_video_requests: false,
            auto_approve_channel_requests: false,
            auto_approve_delete_requests: false,
            max_rating_level: 3,
            allow_unrated: false,
            allowed_media_types: ['video', 'short'],
            revoked_at: null,
          }],
        })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('External Client Family Room')).toBeInTheDocument();
    await expect(await canvas.findByText('Teen · Movies PG-13 · TV TV-14'))
      .toBeInTheDocument();
  },
};
