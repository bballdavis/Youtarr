import { renderHook, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { usePasswordChange } from '../usePasswordChange';

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

const axios = require('axios');
const mockedPost = axios.post;

describe('usePasswordChange', () => {
  const mockToken = 'test-token-123';
  const mockSetSnackbar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hook Initialization', () => {
    test('returns expected state and functions', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      expect(result.current.showPasswordChange).toBe(false);
      expect(result.current.setShowPasswordChange).toBeDefined();
      expect(typeof result.current.setShowPasswordChange).toBe('function');
      expect(result.current.currentPassword).toBe('');
      expect(result.current.newPassword).toBe('');
      expect(result.current.confirmNewPassword).toBe('');
      expect(result.current.handlePasswordFieldChange).toBeDefined();
      expect(typeof result.current.handlePasswordFieldChange).toBe('function');
      expect(result.current.handlePasswordSubmit).toBeDefined();
      expect(typeof result.current.handlePasswordSubmit).toBe('function');
    });

    test('works with null token', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: null,
          setSnackbar: mockSetSnackbar,
        })
      );

      expect(result.current.handlePasswordSubmit).toBeDefined();
      expect(result.current.handlePasswordFieldChange).toBeDefined();
    });
  });

  describe('Show/Hide Password Change Form', () => {
    test('can toggle showPasswordChange state', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      expect(result.current.showPasswordChange).toBe(false);

      act(() => {
        result.current.setShowPasswordChange(true);
      });

      expect(result.current.showPasswordChange).toBe(true);

      act(() => {
        result.current.setShowPasswordChange(false);
      });

      expect(result.current.showPasswordChange).toBe(false);
    });
  });

  describe('Password Field Changes', () => {
    test('updates currentPassword when field is "current"', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password-123');
      });

      expect(result.current.currentPassword).toBe('old-password-123');
      expect(result.current.newPassword).toBe('');
      expect(result.current.confirmNewPassword).toBe('');
    });

    test('updates newPassword when field is "new"', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('new', 'new-password-456');
      });

      expect(result.current.currentPassword).toBe('');
      expect(result.current.newPassword).toBe('new-password-456');
      expect(result.current.confirmNewPassword).toBe('');
    });

    test('updates confirmNewPassword when field is "confirm"', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('confirm', 'confirm-password-789');
      });

      expect(result.current.currentPassword).toBe('');
      expect(result.current.newPassword).toBe('');
      expect(result.current.confirmNewPassword).toBe('confirm-password-789');
    });

    test('updates multiple fields independently', () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-pass');
      });

      act(() => {
        result.current.handlePasswordFieldChange('new', 'new-pass');
      });

      act(() => {
        result.current.handlePasswordFieldChange('confirm', 'confirm-pass');
      });

      expect(result.current.currentPassword).toBe('old-pass');
      expect(result.current.newPassword).toBe('new-pass');
      expect(result.current.confirmNewPassword).toBe('confirm-pass');
    });
  });

  describe('Password Validation', () => {
    test('shows error when passwords do not match', async () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'different-password');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Passwords do not match',
        severity: 'error',
      });
      expect(mockedPost).not.toHaveBeenCalled();
    });

    test('shows error when password is less than 8 characters', async () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'short');
        result.current.handlePasswordFieldChange('confirm', 'short');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Password must be at least 8 characters',
        severity: 'error',
      });
      expect(mockedPost).not.toHaveBeenCalled();
    });

    test('validates password length exactly at 8 characters', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'exactly8');
        result.current.handlePasswordFieldChange('confirm', 'exactly8');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });
    });

    test('validates password length at 7 characters should fail', async () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', '7chars7');
        result.current.handlePasswordFieldChange('confirm', '7chars7');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Password must be at least 8 characters',
        severity: 'error',
      });
      expect(mockedPost).not.toHaveBeenCalled();
    });
  });

  describe('Successful Password Change', () => {
    test('submits password change with correct parameters', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password-123');
        result.current.handlePasswordFieldChange('new', 'new-password-456');
        result.current.handlePasswordFieldChange('confirm', 'new-password-456');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockedPost).toHaveBeenCalledTimes(1);
      expect(mockedPost).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          currentPassword: 'old-password-123',
          newPassword: 'new-password-456',
        },
        {
          headers: {
            'x-access-token': mockToken,
          },
        }
      );
    });

    test('uses empty string for token when null', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: null,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password-123');
        result.current.handlePasswordFieldChange('new', 'new-password-456');
        result.current.handlePasswordFieldChange('confirm', 'new-password-456');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      const callArgs = mockedPost.mock.calls[0];
      expect(callArgs[2]?.headers).toEqual({
        'x-access-token': '',
      });
    });

    test('displays success snackbar on successful password change', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Password updated successfully',
        severity: 'success',
      });
    });

    test('hides password change form on success', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.setShowPasswordChange(true);
      });

      expect(result.current.showPasswordChange).toBe(true);

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(result.current.showPasswordChange).toBe(false);
      });
    });

    test('clears all password fields on success', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      expect(result.current.currentPassword).toBe('old-password');
      expect(result.current.newPassword).toBe('new-password-123');
      expect(result.current.confirmNewPassword).toBe('new-password-123');

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(result.current.currentPassword).toBe('');
      });
      expect(result.current.newPassword).toBe('');
      expect(result.current.confirmNewPassword).toBe('');
    });

    test('handles successful response even when success is not explicitly true', async () => {
      mockedPost.mockResolvedValueOnce({
        data: {},
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      // Should not show success snackbar or clear fields if success is not true
      expect(mockSetSnackbar).not.toHaveBeenCalled();
      expect(result.current.showPasswordChange).toBe(false);
      expect(result.current.currentPassword).toBe('old-password');
    });
  });

  describe('Error Handling', () => {
    test('displays error from server response', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          data: {
            error: 'Current password is incorrect',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'wrong-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Current password is incorrect',
        severity: 'error',
      });
    });

    test('displays generic error when no error message from server', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          data: {},
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Failed to update password',
        severity: 'error',
      });
    });

    test('handles network error', async () => {
      mockedPost.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Failed to update password',
        severity: 'error',
      });
    });

    test('does not clear fields on error', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          data: {
            error: 'Server error',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(result.current.currentPassword).toBe('old-password');
      expect(result.current.newPassword).toBe('new-password-123');
      expect(result.current.confirmNewPassword).toBe('new-password-123');
    });

    test('does not hide form on error', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          data: {
            error: 'Server error',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.setShowPasswordChange(true);
      });

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledTimes(1);
      });

      expect(result.current.showPasswordChange).toBe(true);
    });

    test('handles 401 Unauthorized error', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          status: 401,
          data: {
            error: 'Unauthorized',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledWith({
          open: true,
          message: 'Unauthorized',
          severity: 'error',
        });
      });
    });

    test('handles 403 Forbidden error', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          status: 403,
          data: {
            error: 'Access forbidden',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledWith({
          open: true,
          message: 'Access forbidden',
          severity: 'error',
        });
      });
    });

    test('handles 500 Internal Server Error', async () => {
      mockedPost.mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: 'Internal server error',
          },
        },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'new-password-123');
        result.current.handlePasswordFieldChange('confirm', 'new-password-123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockSetSnackbar).toHaveBeenCalledWith({
          open: true,
          message: 'Internal server error',
          severity: 'error',
        });
      });
    });
  });

  describe('Hook Stability', () => {
    test('handlePasswordFieldChange function reference remains stable', () => {
      const { result, rerender } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      const firstRef = result.current.handlePasswordFieldChange;

      rerender();

      const secondRef = result.current.handlePasswordFieldChange;

      expect(firstRef).toBe(secondRef);
    });

    test('handlePasswordSubmit updates when token changes', () => {
      const { result, rerender } = renderHook(
        ({ token }) =>
          usePasswordChange({
            token,
            setSnackbar: mockSetSnackbar,
          }),
        { initialProps: { token: 'token-1' } }
      );

      const firstRef = result.current.handlePasswordSubmit;

      rerender({ token: 'token-2' });

      const secondRef = result.current.handlePasswordSubmit;

      expect(firstRef).not.toBe(secondRef);
    });

    test('handlePasswordSubmit updates when password fields change', () => {
      const { result, rerender } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      const firstRef = result.current.handlePasswordSubmit;

      act(() => {
        result.current.handlePasswordFieldChange('current', 'new-value');
      });

      rerender();

      const secondRef = result.current.handlePasswordSubmit;

      expect(firstRef).not.toBe(secondRef);
    });

    test('handlePasswordSubmit updates when setSnackbar changes', () => {
      const newSetSnackbar = vi.fn();

      const { result, rerender } = renderHook(
        ({ setSnackbar }) =>
          usePasswordChange({
            token: mockToken,
            setSnackbar,
          }),
        { initialProps: { setSnackbar: mockSetSnackbar } }
      );

      const firstRef = result.current.handlePasswordSubmit;

      rerender({ setSnackbar: newSetSnackbar });

      const secondRef = result.current.handlePasswordSubmit;

      expect(firstRef).not.toBe(secondRef);
    });

    test('can submit password change multiple times', async () => {
      mockedPost
        .mockResolvedValueOnce({
          data: { success: true },
        })
        .mockResolvedValueOnce({
          data: { success: true },
        });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      // First submission
      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password-1');
        result.current.handlePasswordFieldChange('new', 'new-password-1');
        result.current.handlePasswordFieldChange('confirm', 'new-password-1');
      });

      const mockEvent1 = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent1);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      // Second submission
      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password-2');
        result.current.handlePasswordFieldChange('new', 'new-password-2');
        result.current.handlePasswordFieldChange('confirm', 'new-password-2');
      });

      const mockEvent2 = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent2);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(2);
      });

      expect(mockSetSnackbar).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty password fields', async () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Password must be at least 8 characters',
        severity: 'error',
      });
      expect(mockedPost).not.toHaveBeenCalled();
    });

    test('handles whitespace in passwords', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old password');
        result.current.handlePasswordFieldChange('new', 'new password 123');
        result.current.handlePasswordFieldChange('confirm', 'new password 123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      expect(mockedPost).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          currentPassword: 'old password',
          newPassword: 'new password 123',
        },
        expect.any(Object)
      );
    });

    test('handles special characters in passwords', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old!@#$%^&*()');
        result.current.handlePasswordFieldChange('new', 'new!@#$%^&*()');
        result.current.handlePasswordFieldChange('confirm', 'new!@#$%^&*()');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      expect(mockedPost).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          currentPassword: 'old!@#$%^&*()',
          newPassword: 'new!@#$%^&*()',
        },
        expect.any(Object)
      );
    });

    test('handles very long passwords', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      const longPassword = 'a'.repeat(1000);

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', longPassword);
        result.current.handlePasswordFieldChange('confirm', longPassword);
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      expect(mockedPost).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          currentPassword: 'old-password',
          newPassword: longPassword,
        },
        expect.any(Object)
      );
    });

    test('handles unicode characters in passwords', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'старый密码');
        result.current.handlePasswordFieldChange('new', 'новый密码123');
        result.current.handlePasswordFieldChange('confirm', 'новый密码123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledTimes(1);
      });

      expect(mockedPost).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          currentPassword: 'старый密码',
          newPassword: 'новый密码123',
        },
        expect.any(Object)
      );
    });

    test('validates new and confirm passwords match case-sensitively', async () => {
      const { result } = renderHook(() =>
        usePasswordChange({
          token: mockToken,
          setSnackbar: mockSetSnackbar,
        })
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-password');
        result.current.handlePasswordFieldChange('new', 'NewPassword123');
        result.current.handlePasswordFieldChange('confirm', 'newpassword123');
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      expect(mockSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Passwords do not match',
        severity: 'error',
      });
      expect(mockedPost).not.toHaveBeenCalled();
    });
  });

  describe('Callback Dependencies', () => {
    test('includes all dependencies in useCallback for handlePasswordSubmit', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { success: true },
      });

      const newSetSnackbar = vi.fn();
      const newToken = 'new-token-456';

      const { result, rerender } = renderHook(
        (props) => usePasswordChange(props),
        {
          initialProps: {
            token: mockToken,
            setSnackbar: mockSetSnackbar,
          },
        }
      );

      act(() => {
        result.current.handlePasswordFieldChange('current', 'old-pass');
        result.current.handlePasswordFieldChange('new', 'new-pass-123');
        result.current.handlePasswordFieldChange('confirm', 'new-pass-123');
      });

      rerender({
        token: newToken,
        setSnackbar: newSetSnackbar,
      });

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handlePasswordSubmit(mockEvent);
      });

      await waitFor(() => {
        expect(newSetSnackbar).toHaveBeenCalled();
      });

      expect(newSetSnackbar).toHaveBeenCalledWith({
        open: true,
        message: 'Password updated successfully',
        severity: 'success',
      });

      expect(mockSetSnackbar).not.toHaveBeenCalled();

      const callArgs = mockedPost.mock.calls[0];
      expect(callArgs[2]?.headers).toEqual({
        'x-access-token': newToken,
      });
    });
  });
});
