import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { CookieConfigSection } from '../CookieConfigSection';
import { renderWithProviders } from '../../../../test-utils';
import { ConfigState, SnackbarState, CookieStatus } from '../../types';
import { DEFAULT_CONFIG } from '../../../../config/configSchema';

const mockUseCookieManagement = jest.fn();

jest.mock('../../hooks/useCookieManagement', () => ({
  useCookieManagement: (...args: unknown[]) => mockUseCookieManagement(...args),
}));

type HookValue = {
  cookieStatus: CookieStatus | null;
  refreshCookieStatus: jest.Mock;
  uploadingCookie: boolean;
  uploadCookieFile: jest.Mock;
  deleteCookies: jest.Mock;
};

const createHookValue = (overrides: Partial<HookValue> = {}) => {
  const value: HookValue = {
    cookieStatus: null,
    refreshCookieStatus: jest.fn(),
    uploadingCookie: false,
    uploadCookieFile: jest.fn(),
    deleteCookies: jest.fn(),
    ...overrides,
  };
  mockUseCookieManagement.mockReturnValue(value);
  return value;
};

const createConfig = (overrides: Partial<ConfigState> = {}): ConfigState => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const createSectionProps = (
  overrides: Partial<React.ComponentProps<typeof CookieConfigSection>> = {}
): React.ComponentProps<typeof CookieConfigSection> => ({
  token: 'test-token',
  config: createConfig(),
  setConfig: jest.fn() as React.Dispatch<React.SetStateAction<ConfigState>>,
  onConfigChange: jest.fn(),
  setSnackbar: jest.fn() as React.Dispatch<React.SetStateAction<SnackbarState>>,
  onMobileTooltipClick: jest.fn(),
  ...overrides,
});

describe('CookieConfigSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls onConfigChange when toggling the cookie switch', async () => {
    const user = userEvent.setup();
    createHookValue();
    const props = createSectionProps();
    renderWithProviders(<CookieConfigSection {...props} />);

    const toggle = await screen.findByRole('checkbox', { name: /enable cookies/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(props.onConfigChange).toHaveBeenCalledWith({ cookiesEnabled: true });
  });

  test('renders cookie upload controls and handles delete action when cookies are enabled', async () => {
    const user = userEvent.setup();
    const hookValue = createHookValue({
      cookieStatus: {
        cookiesEnabled: true,
        customCookiesUploaded: true,
        customFileExists: true,
      },
    });

    const props = createSectionProps({
      config: createConfig({ cookiesEnabled: true }),
    });

    renderWithProviders(<CookieConfigSection {...props} />);

    expect(await screen.findByRole('button', { name: /upload cookie file/i })).toBeEnabled();
    expect(screen.getByText('Custom cookies uploaded')).toBeInTheDocument();
    expect(screen.getByText('Status: Using custom cookies')).toBeInTheDocument();

    const deleteButton = screen.getByRole('button', { name: /delete custom cookies/i });
    await user.click(deleteButton);

    expect(hookValue.deleteCookies).toHaveBeenCalledTimes(1);
  });

  test('passes selected file to uploadCookieFile via the hook', async () => {
    const user = userEvent.setup();
    const hookValue = createHookValue();
    const props = createSectionProps({
      config: createConfig({ cookiesEnabled: true }),
    });

    renderWithProviders(<CookieConfigSection {...props} />);

    const fileInput = screen.getByTestId('cookie-file-input') as HTMLInputElement;
    const file = new File(['cookie-data'], 'cookies.txt', { type: 'text/plain' });

    await user.upload(fileInput, file);

    expect(hookValue.uploadCookieFile).toHaveBeenCalledWith(file);
  });

  test('shows external source status and refreshes it without upload or delete controls', async () => {
    const user = userEvent.setup();
    const hookValue = createHookValue({
      cookieStatus: {
        cookiesEnabled: true,
        customCookiesUploaded: true,
        customFileExists: true,
        external: {
          path: '/app/external-cookies/cookies.txt',
          ready: true,
          lastModified: '2026-09-05T12:00:00.000Z',
          warning: null,
          error: null,
        },
      },
    });
    renderWithProviders(<CookieConfigSection {...createSectionProps({
      config: createConfig({ cookiesEnabled: true }),
    })} />);

    expect(screen.getByText('Cookies managed externally')).toBeInTheDocument();
    expect(screen.getByText(/Source: \/app\/external-cookies\/cookies.txt/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload cookie file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete custom cookies/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /refresh file status/i }));
    expect(hookValue.refreshCookieStatus).toHaveBeenCalledTimes(1);
  });

  test('shows external errors and the enable instruction even while cookies are disabled', () => {
    createHookValue({
      cookieStatus: {
        cookiesEnabled: false,
        customCookiesUploaded: false,
        customFileExists: false,
        external: {
          path: '/app/external-cookies/cookies.txt',
          ready: false,
          lastModified: null,
          warning: null,
          error: 'External cookies: the file was not found.',
        },
      },
    });
    renderWithProviders(<CookieConfigSection {...createSectionProps()} />);
    expect(screen.getByText('External cookies: the file was not found.')).toBeInTheDocument();
    expect(screen.getByText('Enable Cookies and save your configuration to use this file.')).toBeInTheDocument();
    expect(screen.getByText(/Operations would run without cookies/)).toBeInTheDocument();
  });

  test('explains that an unusable external file is skipped while cookies stay enabled', () => {
    createHookValue({
      cookieStatus: {
        cookiesEnabled: true,
        customCookiesUploaded: false,
        customFileExists: false,
        external: {
          path: '/app/config/cookies.external.txt',
          ready: false,
          lastModified: null,
          warning: null,
          error: 'External cookies: yt-dlp could not load the file.',
        },
      },
    });
    renderWithProviders(<CookieConfigSection {...createSectionProps({
      config: createConfig({ cookiesEnabled: true }),
    })} />);
    expect(screen.getByText(/Operations will continue without cookies/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable cookies/i })).toBeChecked();
    expect(screen.getByText('External cookie warning')).toBeInTheDocument();
  });

  test('shows parser warnings even when cookies can be loaded', () => {
    const warning = 'yt-dlp reported warnings while loading the file. Only the cookies it loaded will be used.';
    createHookValue({
      cookieStatus: {
        cookiesEnabled: true,
        customCookiesUploaded: false,
        customFileExists: false,
        external: { path: '/app/config/cookies.external.txt', ready: true, lastModified: null, warning, error: null },
      },
    });
    renderWithProviders(<CookieConfigSection {...createSectionProps({
      config: createConfig({ cookiesEnabled: true }),
    })} />);
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.queryByText(/Operations will continue without cookies/)).not.toBeInTheDocument();
  });

  test('offers expandable external-file setup instructions before cookies are enabled', async () => {
    const user = userEvent.setup();
    createHookValue();
    renderWithProviders(<CookieConfigSection {...createSectionProps()} />);
    const help = screen.getByRole('button', { name: /Refresh cookies automatically with YOUTARR_COOKIES_FILE/ });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    await user.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('YOUTARR_COOKIES_FILE=/app/config/cookies.external.txt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Setup guide and other mount locations/ })).toHaveAttribute('href',
      'https://github.com/DialmasterOrg/Youtarr/blob/dev/docs/CONFIG.md#external-cookie-file');
  });
});
