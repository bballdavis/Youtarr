import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { CookieConfigSection } from '../CookieConfigSection';
import { renderWithProviders } from '../../../../test-utils';
import { ConfigState, SnackbarState, CookieStatus } from '../../types';
import { DEFAULT_CONFIG } from '../../../../config/configSchema';

const mockUseCookieManagement = vi.fn();

vi.mock('../../hooks/useCookieManagement', () => ({
  useCookieManagement: (...args: unknown[]) => mockUseCookieManagement(...args),
}));

type HookValue = {
  cookieStatus: CookieStatus | null;
  uploadingCookie: boolean;
  uploadCookieFile: any;
  deleteCookies: any;
};

const createHookValue = (overrides: Partial<HookValue> = {}) => {
  const value: HookValue = {
    cookieStatus: null,
    uploadingCookie: false,
    uploadCookieFile: vi.fn(),
    deleteCookies: vi.fn(),
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
  setConfig: vi.fn() as React.Dispatch<React.SetStateAction<ConfigState>>,
  onConfigChange: vi.fn(),
  setSnackbar: vi.fn() as React.Dispatch<React.SetStateAction<SnackbarState>>,
  onMobileTooltipClick: vi.fn(),
  ...overrides,
});

const expandAccordion = async (user: ReturnType<typeof userEvent.setup>) => {
  const accordionToggle = screen.getByRole('button', { name: /cookie configuration/i });
  await user.click(accordionToggle);
};

describe('CookieConfigSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('calls onConfigChange when toggling the cookie switch', async () => {
    const user = userEvent.setup();
    createHookValue();
    const props = createSectionProps();
    renderWithProviders(<CookieConfigSection {...props} />);

    await expandAccordion(user);
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

    await expandAccordion(user);
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

    await expandAccordion(user);
    const fileInput = screen.getByTestId('cookie-file-input') as HTMLInputElement;
    const file = new File(['cookie-data'], 'cookies.txt', { type: 'text/plain' });

    await user.upload(fileInput, file);

    expect(hookValue.uploadCookieFile).toHaveBeenCalledWith(file);
  });
});
