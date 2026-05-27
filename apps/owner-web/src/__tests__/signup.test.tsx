/**
 * Owner-web signup wizard — render + flow tests.
 *
 * Covers:
 *   1. Step 1 renders both kind cards
 *   2. Picking INDIVIDUAL advances to step 2a
 *   3. Picking BUSINESS advances to step 2b
 *   4. Form persists to localStorage between renders
 *   5. Completing INDIVIDUAL step 2a advances to step 3 with the
 *      draft preserved
 *   6. Step 3 review surface shows the draft summary
 *   7. POST /api/v1/orgs/signup is invoked with the discriminated
 *      body on submit
 *   8. OTP verification success calls router.replace('/')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { SignupWizard } from '@/components/signup/SignupWizard';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    refresh: refreshMock,
  }),
}));

const verifyOtpMock = vi.fn(async () => ({ error: null }));
const getSessionMock = vi.fn(async () => ({
  data: { session: null },
  error: null,
}));
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      verifyOtp: verifyOtpMock,
      getSession: getSessionMock,
    },
  }),
}));

beforeEach(() => {
  replaceMock.mockClear();
  refreshMock.mockClear();
  verifyOtpMock.mockClear();
  getSessionMock.mockClear();
  window.localStorage.clear();
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  window.localStorage.clear();
});

async function flushHydration(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId('signup-wizard')).toBeTruthy();
  });
}

describe('SignupWizard · Step 1 (kind picker)', () => {
  it('renders both kind cards on first mount', async () => {
    render(<SignupWizard />);
    await flushHydration();
    expect(screen.getByTestId('signup-kind-card-individual')).toBeTruthy();
    expect(screen.getByTestId('signup-kind-card-business')).toBeTruthy();
  });

  it('renders the bilingual Swahili-first headline', async () => {
    render(<SignupWizard />);
    await flushHydration();
    const indiv = screen.getByTestId('signup-kind-card-individual');
    expect(indiv.textContent ?? '').toContain('Mimi ni mtu binafsi');
    const biz = screen.getByTestId('signup-kind-card-business');
    expect(biz.textContent ?? '').toContain('Mimi nina kampuni');
  });
});

describe('SignupWizard · advances to step 2 based on kind', () => {
  it('clicking INDIVIDUAL card renders step 2a', async () => {
    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    expect(screen.queryByTestId('signup-business-step')).toBeNull();
  });

  it('clicking BUSINESS card renders step 2b', async () => {
    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-business'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-business-step')).toBeTruthy();
    });
    expect(screen.queryByTestId('signup-individual-step')).toBeNull();
  });
});

describe('SignupWizard · localStorage persistence', () => {
  it('persists step+draft state to localStorage when the kind is chosen', async () => {
    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    const stored = window.localStorage.getItem('borjie.signup.draft.v1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '{}');
    expect(parsed.step).toBe(2);
    expect(parsed.draft?.kind).toBe('individual');
  });

  it('restores from localStorage on re-mount', async () => {
    window.localStorage.setItem(
      'borjie.signup.draft.v1',
      JSON.stringify({
        step: 2,
        draft: {
          kind: 'business',
          country: 'TZ',
          orgName: 'Mawe Bora Ltd',
          businessRegistrationNumber: 'BRELA-1',
          taxId: 'TIN-1',
          ownerEmail: 'ceo@example.com',
          ownerFullName: 'Yusuf Mwanaidi',
          ownerPhoneE164: '+255700123456',
          miningLicenceNumber: '',
          vatNumber: '',
          defaultLanguage: 'sw',
          primaryCurrency: 'TZS',
        },
        tenantId: null,
        ownerUserId: null,
      }),
    );
    render(<SignupWizard />);
    await flushHydration();
    await waitFor(() => {
      expect(screen.queryByTestId('signup-business-step')).toBeTruthy();
    });
    const orgInput = screen.getByTestId('signup-business-orgName') as HTMLInputElement;
    expect(orgInput.value).toBe('Mawe Bora Ltd');
  });
});

describe('SignupWizard · individual happy-path through to step 3', () => {
  it('captures the form values and advances to step 3 review', async () => {
    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-individual-fullName'), {
      target: { value: 'Asha Mwanaidi' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-phone'), {
      target: { value: '+255712345678' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-email'), {
      target: { value: 'asha@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-individual-next'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-step')).toBeTruthy();
    });
    expect(screen.getByTestId('signup-contact-step').textContent ?? '').toContain(
      'Asha Mwanaidi',
    );
  });
});

describe('SignupWizard · POST /api/v1/orgs/signup wire', () => {
  it('invokes the gateway with the discriminated body and stores tenantId', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          tenantId: 'tn_test_1',
          ownerUserId: 'usr_test_1',
          kind: 'individual',
          signupStatus: 'pending_otp_verification',
          otpRequired: true,
          kycAtomsInitialized: ['national_id_pending', 'address_pending'],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-individual-fullName'), {
      target: { value: 'Asha Mwanaidi' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-phone'), {
      target: { value: '+255712345678' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-email'), {
      target: { value: 'asha@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-individual-next'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-step')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-contact-submit'));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/orgs\/signup$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.kind).toBe('individual');
    expect(body.email).toBe('asha@example.com');
    expect(body.phoneE164).toBe('+255712345678');
  });
});

describe('SignupWizard · OTP verify success redirects to /', () => {
  it('calls router.replace("/") after a successful verifyOtp', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tenantId: 'tn_test_1',
          ownerUserId: 'usr_test_1',
          kind: 'individual',
          signupStatus: 'pending_otp_verification',
          otpRequired: true,
          kycAtomsInitialized: ['national_id_pending', 'address_pending'],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    verifyOtpMock.mockResolvedValueOnce({ error: null });

    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-individual-fullName'), {
      target: { value: 'Asha Mwanaidi' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-phone'), {
      target: { value: '+255712345678' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-email'), {
      target: { value: 'asha@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-individual-next'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-step')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-contact-submit'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-otp')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-contact-otp'), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-contact-verify'));
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      phone: '+255712345678',
      token: '123456',
      type: 'sms',
    });
  });
});

describe('SignupWizard · OTP verify failure shows error', () => {
  it('surfaces the Supabase error message without redirecting', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tenantId: 'tn_test_1',
          ownerUserId: 'usr_test_1',
          kind: 'individual',
          signupStatus: 'pending_otp_verification',
          otpRequired: true,
          kycAtomsInitialized: ['national_id_pending', 'address_pending'],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    verifyOtpMock.mockResolvedValueOnce({
      error: { message: 'OTP iliyokwisha muda' } as unknown,
    } as never);

    render(<SignupWizard />);
    await flushHydration();
    fireEvent.click(screen.getByTestId('signup-kind-card-individual'));
    await waitFor(() => {
      expect(screen.queryByTestId('signup-individual-step')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-individual-fullName'), {
      target: { value: 'Asha Mwanaidi' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-phone'), {
      target: { value: '+255712345678' },
    });
    fireEvent.input(screen.getByTestId('signup-individual-email'), {
      target: { value: 'asha@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-individual-next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-contact-submit'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-otp')).toBeTruthy();
    });
    fireEvent.input(screen.getByTestId('signup-contact-otp'), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('signup-contact-verify'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('signup-contact-error')).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalledWith('/');
  });
});
