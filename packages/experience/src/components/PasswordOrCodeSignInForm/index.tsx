/**
 * Fork (logto-friends): a single-step sign-in form with an identifier field and an
 * optional password field. If a password is entered, sign in with it. If it is left
 * empty and the identifier type supports verification codes, send a code instead.
 * Identifier types without verification code (e.g. username) still require a password.
 */
import { AgreeToTermsPolicy, SignInIdentifier, type SignIn } from '@logto/schemas';
import classNames from 'classnames';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import WebAuthnContext from '@/Providers/WebAuthnContextProvider/WebAuthnContext';
import LockIcon from '@/assets/icons/lock.svg?react';
import { SmartInputField, PasswordInputField } from '@/components/InputFields';
import styles from '@/components/PasswordSignInForm/index.module.scss';
import CaptchaBox from '@/containers/CaptchaBox';
import ForgotPasswordLink from '@/containers/ForgotPasswordLink';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import useCheckSingleSignOn from '@/hooks/use-check-single-sign-on';
import usePasswordSignIn from '@/hooks/use-password-sign-in';
import usePrefilledIdentifier from '@/hooks/use-prefilled-identifier';
import useSendVerificationCode from '@/hooks/use-send-verification-code';
import { useForgotPasswordSettings, useSieMethods } from '@/hooks/use-sie';
import useSingleSignOnWatch from '@/hooks/use-single-sign-on-watch';
import useTerms from '@/hooks/use-terms';
import Button from '@/shared/components/Button';
import ErrorMessage from '@/shared/components/ErrorMessage';
import type { IdentifierInputValue } from '@/shared/components/InputFields/SmartInputField';
import { UserFlow } from '@/types';
import { getGeneralIdentifierErrorMessage, validateIdentifierField } from '@/utils/form';

type Props = {
  readonly className?: string;
  // eslint-disable-next-line react/boolean-prop-naming -- mirrors the other sign-in forms
  readonly autoFocus?: boolean;
  readonly signInMethods: SignIn['methods'];
};

type FormState = {
  identifier: IdentifierInputValue;
  password: string;
};

/** Use this form when at least one identifier allows both password and verification code. */
export const shouldUsePasswordOrCodeSignInForm = (signInMethods: SignIn['methods']) =>
  signInMethods.some(({ password, verificationCode }) => password && verificationCode);

const PasswordOrCodeSignInForm = ({ className, autoFocus, signInMethods }: Props) => {
  const { t } = useTranslation();

  const {
    errorMessage: passwordErrorMessage,
    clearErrorMessage: clearPasswordErrorMessage,
    onSubmit: signInWithPassword,
  } = usePasswordSignIn();
  const {
    errorMessage: codeErrorMessage,
    clearErrorMessage: clearCodeErrorMessage,
    onSubmit: sendVerificationCode,
  } = useSendVerificationCode(UserFlow.SignIn);
  const { onSubmit: checkSingleSignOn } = useCheckSingleSignOn();
  const { ssoConnectors } = useSieMethods();
  const { isForgotPasswordEnabled } = useForgotPasswordSettings();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const { setIdentifierInputValue } = useContext(UserInteractionContext);
  const { isPasskeyFlowProcessing } = useContext(WebAuthnContext);

  const enabledIdentifiers = useMemo(
    () => signInMethods.map(({ identifier }) => identifier),
    [signInMethods]
  );
  const prefilledIdentifier = usePrefilledIdentifier({ enabledIdentifiers });

  const {
    watch,
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FormState>({
    reValidateMode: 'onBlur',
    defaultValues: {
      identifier: prefilledIdentifier,
      password: '',
    },
  });

  const identifier = watch('identifier');
  const password = watch('password');

  const { showSingleSignOnForm, navigateToSingleSignOn } = useSingleSignOnWatch(identifier);

  const methodSupportsCode = useCallback(
    (type?: SignInIdentifier) =>
      type !== undefined &&
      type !== SignInIdentifier.Username &&
      Boolean(signInMethods.find((method) => method.identifier === type)?.verificationCode),
    [signInMethods]
  );

  // Before the identifier type is known, assume the code option applies, since this form
  // is only used when some identifier supports it.
  const isPasswordOptional = identifier.type ? methodSupportsCode(identifier.type) : true;
  const willSendCode = isPasswordOptional && !password;

  // Both hooks clear their message to an empty string, so pick the first non-empty one.
  const errorMessage = [passwordErrorMessage, codeErrorMessage].find(Boolean);

  const clearErrorMessage = useCallback(() => {
    clearPasswordErrorMessage();
    clearCodeErrorMessage();
  }, [clearCodeErrorMessage, clearPasswordErrorMessage]);

  const onSubmitHandler = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      if (isPasskeyFlowProcessing) {
        return;
      }

      clearErrorMessage();

      await handleSubmit(async ({ identifier: { type, value }, password }) => {
        if (!type) {
          return;
        }

        setIdentifierInputValue({ type, value });

        if (showSingleSignOnForm) {
          await navigateToSingleSignOn();
          return;
        }

        // Check if the user has agreed to the terms and privacy policy before signing in when the policy is set to `Manual`
        if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
          return;
        }

        if (password) {
          await signInWithPassword({ identifier: { type, value }, password });
          return;
        }

        // Narrowed again for the type checker: username never supports verification code.
        if (type === SignInIdentifier.Username || !methodSupportsCode(type)) {
          setError('password', { message: t('error.password_required') });
          return;
        }

        // Check if the email is registered with any SSO connectors
        if (type === SignInIdentifier.Email && ssoConnectors.length > 0) {
          const result = await checkSingleSignOn(value);

          if (result) {
            return;
          }
        }

        await sendVerificationCode({ identifier: type, value }, undefined, {
          // The email service usage cap blocks the code send. Ask for the password instead.
          'connector.usage_limit_exceeded': () => {
            setError('password', {
              message: t('error.send_verification_code_failed_use_password'),
            });
          },
        });
      })(event);
    },
    [
      agreeToTermsPolicy,
      checkSingleSignOn,
      clearErrorMessage,
      handleSubmit,
      isPasskeyFlowProcessing,
      methodSupportsCode,
      navigateToSingleSignOn,
      sendVerificationCode,
      setError,
      setIdentifierInputValue,
      showSingleSignOnForm,
      signInWithPassword,
      ssoConnectors.length,
      t,
      termsValidation,
    ]
  );

  useEffect(() => {
    if (!isValid) {
      clearErrorMessage();
    }
  }, [clearErrorMessage, isValid]);

  return (
    <form className={classNames(styles.form, className)} onSubmit={onSubmitHandler}>
      <Controller
        control={control}
        name="identifier"
        rules={{
          validate: ({ type, value }) => {
            if (!type || !value) {
              return getGeneralIdentifierErrorMessage(enabledIdentifiers, 'required');
            }

            const errorMessage = validateIdentifierField(type, value);

            return errorMessage
              ? getGeneralIdentifierErrorMessage(enabledIdentifiers, 'invalid')
              : true;
          },
        }}
        render={({ field, formState: { defaultValues } }) => (
          <SmartInputField
            autoFocus={autoFocus}
            className={styles.inputField}
            {...field}
            isDanger={!!errors.identifier}
            errorMessage={errors.identifier?.message}
            enabledTypes={enabledIdentifiers}
            defaultValue={defaultValues?.identifier?.value}
          />
        )}
      />
      {showSingleSignOnForm && (
        <div className={styles.message}>{t('description.single_sign_on_enabled')}</div>
      )}

      {!showSingleSignOnForm && (
        <PasswordInputField
          className={styles.inputField}
          autoComplete="current-password"
          label={t('input.password')}
          required={!isPasswordOptional}
          isDanger={!!errors.password}
          errorMessage={errors.password?.message}
          {...register('password', {
            validate: (value, { identifier: { type } }) =>
              Boolean(value) || methodSupportsCode(type) || t('error.password_required'),
          })}
        />
      )}

      {errorMessage && <ErrorMessage className={styles.formErrors}>{errorMessage}</ErrorMessage>}

      {isForgotPasswordEnabled && !showSingleSignOnForm && (
        <ForgotPasswordLink
          className={styles.link}
          identifier={identifier.type}
          value={identifier.value}
        />
      )}

      {/**
       * Have to use css to hide the terms element.
       * Remove element from dom will trigger a form re-render.
       * Form rerender will trigger autofill.
       * If the autofill value is SSO enabled, it will always show SSO form.
       */}
      <TermsAndPrivacyCheckbox
        className={classNames(
          styles.terms,
          // For sign in, only show the terms checkbox if the terms policy is manual
          agreeToTermsPolicy !== AgreeToTermsPolicy.Manual && styles.hidden
        )}
      />

      <CaptchaBox />

      <Button
        name="submit"
        title={
          showSingleSignOnForm
            ? 'action.single_sign_on'
            : willSendCode
              ? 'action.sign_in_via_passcode'
              : 'action.sign_in'
        }
        icon={showSingleSignOnForm ? <LockIcon /> : undefined}
        htmlType="submit"
        isLoading={isSubmitting || isPasskeyFlowProcessing}
      />

      <input hidden type="submit" />
    </form>
  );
};

export default PasswordOrCodeSignInForm;
