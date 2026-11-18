/**
 * Fork (logto-friends): passkey and social sign-in shown above the identifier form,
 * followed by an "or" divider. Upstream renders these below the form.
 */
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useContext } from 'react';

import SingleSignOnFormModeContext from '@/Providers/SingleSignOnFormModeContextProvider/SingleSignOnFormModeContext';
import PasskeySignInButton from '@/components/Button/PasskeySignInButton';
import Divider from '@/components/Divider';
import SocialSignInList from '@/containers/SocialSignInList';
import { useSieMethods } from '@/hooks/use-sie';

import styles from './index.module.scss';

const TopMethods = () => {
  const { signInMethods, socialConnectors, passkeySignIn } = useSieMethods();
  const { showSingleSignOnForm } = useContext(SingleSignOnFormModeContext);

  if (showSingleSignOnForm) {
    return null;
  }

  const showPasskey = Boolean(
    passkeySignIn?.enabled && passkeySignIn.showPasskeyButton && browserSupportsWebAuthn()
  );
  // When there are no identifier sign-in methods, `Main` renders the social list itself.
  const showSocial = signInMethods.length > 0 && socialConnectors.length > 0;

  if (!showPasskey && !showSocial) {
    return null;
  }

  return (
    <>
      {showPasskey && (
        <div className={styles.passkey}>
          <PasskeySignInButton />
        </div>
      )}
      {showSocial && (
        <SocialSignInList socialConnectors={socialConnectors} className={styles.social} />
      )}
      {signInMethods.length > 0 && <Divider label="description.or" className={styles.divider} />}
    </>
  );
};

export default TopMethods;
