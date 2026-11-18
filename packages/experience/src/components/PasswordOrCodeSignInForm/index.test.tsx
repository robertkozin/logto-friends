import { SignInIdentifier, type SignIn } from '@logto/schemas';
import { assert } from '@silverhand/essentials';
import { fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';

import ConfirmModalProvider from '@/Providers/ConfirmModalProvider';
import SingleSignOnFormModeContextProvider from '@/Providers/SingleSignOnFormModeContextProvider';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import SettingsProvider from '@/__mocks__/RenderWithPageContext/SettingsProvider';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';
import { signInWithPasswordIdentifier } from '@/apis/experience';
import { sendVerificationCodeApi } from '@/apis/utils';
import { UserFlow } from '@/types';

import PasswordOrCodeSignInForm from '.';

jest.mock('react-device-detect', () => ({
  isMobile: true,
}));

jest.mock('i18next', () => ({
  ...jest.requireActual('i18next'),
  language: 'en',
  t: (key: string) => key,
}));

jest.mock('@/apis/utils', () => ({
  sendVerificationCodeApi: jest.fn(async () => ({ verificationId: 'foo' })),
}));

jest.mock('@/apis/experience', () => ({
  initInteraction: jest.fn(),
  signInWithPasswordIdentifier: jest.fn(async () => ({ redirectTo: '/' })),
  getSsoConnectors: jest.fn(async () => ({ connectorIds: [] })),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

const signInMethods: SignIn['methods'] = [
  {
    identifier: SignInIdentifier.Username,
    password: true,
    verificationCode: false,
    isPasswordPrimary: true,
  },
  {
    identifier: SignInIdentifier.Email,
    password: true,
    verificationCode: true,
    isPasswordPrimary: true,
  },
];

const renderForm = () =>
  renderWithPageContext(
    <SettingsProvider settings={{ ...mockSignInExperienceSettings, ssoConnectors: [] }}>
      <ConfirmModalProvider>
        <UserInteractionContextProvider>
          <SingleSignOnFormModeContextProvider>
            <PasswordOrCodeSignInForm signInMethods={signInMethods} />
          </SingleSignOnFormModeContextProvider>
        </UserInteractionContextProvider>
      </ConfirmModalProvider>
    </SettingsProvider>
  );

const getInputs = (container: HTMLElement) => {
  const identifierInput = container.querySelector('input[name="identifier"]');
  const passwordInput = container.querySelector('input[name="password"]');
  assert(identifierInput, new Error('identifier input should exist'));
  assert(passwordInput, new Error('password input should exist'));

  return { identifierInput, passwordInput };
};

describe('PasswordOrCodeSignInForm', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('sends a verification code when the password is empty', async () => {
    const { container, getByText } = renderForm();
    const { identifierInput } = getInputs(container);

    act(() => {
      fireEvent.change(identifierInput, { target: { value: 'foo@logto.io' } });
    });

    const submitButton = getByText('action.sign_in_via_passcode');

    act(() => {
      fireEvent.submit(submitButton);
    });

    await waitFor(() => {
      expect(sendVerificationCodeApi).toBeCalledWith(
        UserFlow.SignIn,
        { type: SignInIdentifier.Email, value: 'foo@logto.io' },
        undefined,
        undefined
      );
      expect(signInWithPasswordIdentifier).not.toBeCalled();
    });
  });

  test('signs in with password when one is entered', async () => {
    const { container, getByText } = renderForm();
    const { identifierInput, passwordInput } = getInputs(container);

    act(() => {
      fireEvent.change(identifierInput, { target: { value: 'foo@logto.io' } });
      fireEvent.change(passwordInput, { target: { value: 'secret' } });
    });

    const submitButton = getByText('action.sign_in');

    act(() => {
      fireEvent.submit(submitButton);
    });

    await waitFor(() => {
      expect(signInWithPasswordIdentifier).toBeCalledWith(
        {
          identifier: { type: SignInIdentifier.Email, value: 'foo@logto.io' },
          password: 'secret',
        },
        undefined
      );
      expect(sendVerificationCodeApi).not.toBeCalled();
    });
  });

  test('requires a password for username', async () => {
    const { container, getByText, queryByText } = renderForm();
    const { identifierInput } = getInputs(container);

    act(() => {
      fireEvent.change(identifierInput, { target: { value: 'foo' } });
    });

    const submitButton = getByText('action.sign_in');

    act(() => {
      fireEvent.submit(submitButton);
    });

    await waitFor(() => {
      expect(queryByText('error.password_required')).not.toBeNull();
      expect(sendVerificationCodeApi).not.toBeCalled();
      expect(signInWithPasswordIdentifier).not.toBeCalled();
    });
  });
});
