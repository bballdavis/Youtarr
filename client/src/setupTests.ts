import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Create a jest alias that works with Vitest
// This allows all jest.* calls to work transparently
(globalThis as any).jest = vi;

// Mock matchMedia for MUI/JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

