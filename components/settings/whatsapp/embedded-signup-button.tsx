'use client';

/**
 * Meta's Embedded Signup, which is the flow a business owner should actually use.
 *
 * What this component does and — more importantly — does not do. Meta's dialog runs inside
 * Facebook's own popup, so the business signs in to Meta, picks or creates its WhatsApp
 * Business account, and verifies its number without any of that passing through ConvoNexa.
 * What comes back to us is an authorization code and the ids of the assets the business
 * selected. The code is not a credential we can use; it is exchanged for one server-side,
 * with the app secret, inside `completeEmbeddedSignupAction`.
 *
 * So this file handles no secret at all. The app id it initialises the SDK with is public by
 * construction — it appears in the popup URL — and the state token is signed rather than
 * secret. The ids Meta posts back are claims: the onboarding service reads the WABA back
 * with the exchanged token and requires the phone number to be listed on it, so an id
 * belonging to somebody else dies on the server rather than here.
 *
 * Two facts about Meta's flow shape the code. The `message` event carries the asset ids and
 * `FB.login`'s callback carries the code, and they arrive in either order — hence the two
 * refs and the submit-when-both-present check. And the authorization code lives about
 * thirty seconds, so the form is submitted the moment the pair is complete rather than
 * waiting for a click.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import {
  completeEmbeddedSignupAction,
  startEmbeddedSignupAction,
} from '@/server/actions/meta-connection.actions';

/**
 * The shape Meta posts into the opener window during signup.
 *
 * Narrowed by hand rather than typed from an SDK, because `@types/facebook-js-sdk` does not
 * describe this message and inventing a fuller type would be a guess about Meta's payload.
 * Only the three fields we act on are read; anything else Meta sends is ignored.
 */
type EmbeddedSignupMessage = {
  type: 'WA_EMBEDDED_SIGNUP';
  event: string;
  data?: { waba_id?: string; phone_number_id?: string };
};

type FacebookLoginResponse = {
  authResponse?: { code?: string } | null;
  status?: string;
};

type FacebookSdk = {
  init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SCRIPT_ID = 'facebook-jssdk';

function isSignupMessage(value: unknown): value is EmbeddedSignupMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<EmbeddedSignupMessage>;
  return candidate.type === 'WA_EMBEDDED_SIGNUP' && typeof candidate.event === 'string';
}

type EmbeddedSignupButtonProps = {
  /** ConvoNexa's Meta app id. Public by construction — it appears in the popup URL. */
  appId: string;
  /** The Facebook Login for Business configuration that defines which assets are asked for. */
  configId: string;
  /** Graph version the SDK initialises with, kept in step with the server's own calls. */
  graphVersion: string;
  isUpdate?: boolean;
};

export function EmbeddedSignupButton({
  appId,
  configId,
  graphVersion,
  isUpdate = false,
}: EmbeddedSignupButtonProps) {
  const [state, formAction] = useActionState(completeEmbeddedSignupAction, IDLE_FORM_STATE);
  const [sdkReady, setSdkReady] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const wabaRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  // Loaded here rather than through `next/script` so the SDK is fetched only on the screen
  // that can use it, and only for a deployment that has Embedded Signup configured.
  useEffect(() => {
    if (window.FB) {
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      setSdkReady(true);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      setSdkReady(true);
    };

    if (document.getElementById(SDK_SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () =>
      setProblem(
        'We could not load Meta’s sign-in. Check your internet connection, or connect with an access token instead.',
      );
    document.body.appendChild(script);
  }, [appId, graphVersion]);

  /** Submits once the code and both asset ids are in hand, whichever arrived last. */
  const submitWhenComplete = useCallback(() => {
    if (!codeRef.current?.value || !wabaRef.current?.value || !phoneRef.current?.value) return;
    setLaunching(false);
    formRef.current?.requestSubmit();
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Origin check first. Without it any page in this tab's opener chain could post a
      // WABA id of its choosing and have us try to connect it.
      let origin: string;
      try {
        origin = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!origin.endsWith('facebook.com')) return;

      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!isSignupMessage(payload)) return;

      if (payload.event === 'FINISH' || payload.event === 'FINISH_ONLY_WABA') {
        if (payload.data?.waba_id && wabaRef.current) wabaRef.current.value = payload.data.waba_id;
        if (payload.data?.phone_number_id && phoneRef.current) {
          phoneRef.current.value = payload.data.phone_number_id;
        }
        submitWhenComplete();
        return;
      }

      if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        setLaunching(false);
        setProblem(
          'The connection was not finished in Meta’s window. You can start again, or connect with an access token instead.',
        );
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [submitWhenComplete]);

  async function launch() {
    setProblem(null);
    setLaunching(true);

    // The state is minted server-side for this workspace and membership, so a code obtained
    // in another session cannot be posted into this one.
    const started = await startEmbeddedSignupAction();
    if (!started.ok) {
      setLaunching(false);
      setProblem(started.message);
      return;
    }
    if (stateRef.current) stateRef.current.value = started.state;

    const sdk = window.FB;
    if (!sdk) {
      setLaunching(false);
      setProblem('Meta’s sign-in is still loading. Try again in a moment.');
      return;
    }

    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setLaunching(false);
          // Includes the case where the owner closed the popup, which is not an error
          // worth alarming them about.
          setProblem(
            'Meta did not complete the sign-in. You can start again, or connect with an access token instead.',
          );
          return;
        }
        if (codeRef.current) codeRef.current.value = code;
        submitWhenComplete();
      },
      {
        config_id: configId,
        // `code` plus the override is what makes Meta return an authorization code to be
        // exchanged on the server, instead of an access token in the browser.
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert state={state} successTitle="WhatsApp is connected" />

      {problem ? (
        <p className="text-sm text-destructive" role="status">
          {problem}
        </p>
      ) : null}

      <form ref={formRef} action={formAction} className="contents">
        <input ref={codeRef} type="hidden" name="code" />
        <input ref={wabaRef} type="hidden" name="wabaId" />
        <input ref={phoneRef} type="hidden" name="phoneNumberId" />
        <input ref={stateRef} type="hidden" name="state" />
      </form>

      <div>
        <Button onClick={launch} isLoading={launching} disabled={!sdkReady}>
          {isUpdate ? 'Reconnect with Meta' : 'Connect with Meta'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {sdkReady
          ? 'You will sign in to Meta, choose your WhatsApp Business account, and confirm your number. Nothing you type into Meta’s window passes through ConvoNexa.'
          : 'Loading Meta’s sign-in…'}
      </p>
    </div>
  );
}
