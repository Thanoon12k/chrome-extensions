export function authorizationCode(callbackUrl, expectedRedirect) {
  if (!callbackUrl) throw new Error('Google sign-in was cancelled.');
  let actual;
  try { actual = new URL(callbackUrl); } catch { throw new Error('Invalid Google sign-in response.'); }
  const expected = new URL(expectedRedirect);
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.hash) {
    throw new Error('Google sign-in returned to an unexpected address.');
  }
  if (actual.searchParams.has('error')) throw new Error('Google sign-in was not completed. Please try again.');
  const codes = actual.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error('Google sign-in did not return an authorization code.');
  return codes[0];
}

export async function googleSignIn(client, identity) {
  const redirectTo = identity.getRedirectURL('supabase');
  const response = await client.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' }
  } });
  if (response.error) throw response.error;
  const authUrl = new URL(response.data.url);
  if (authUrl.protocol !== 'https:' || authUrl.searchParams.get('provider') !== 'google') {
    throw new Error('Invalid sign-in URL.');
  }
  const finalUrl = await identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });
  const code = authorizationCode(finalUrl, redirectTo);
  const exchanged = await client.auth.exchangeCodeForSession(code);
  if (exchanged.error) throw exchanged.error;
  if (!exchanged.data.session?.user?.id) throw new Error('Google sign-in did not create a session.');
  return exchanged.data.session;
}

export function oauthError(error) {
  if (/cancel|closed|did not approve|interaction.*required/i.test(error?.message ?? '')) return 'Google sign-in was cancelled. You can try again.';
  // Avoid displaying callback URLs, authorization codes, or tokens in UI errors.
  return 'Google sign-in could not finish. Try again. If it keeps happening, check the extension callback in Supabase URL Configuration.';
}
