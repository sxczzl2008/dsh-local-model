// The local placeholder belongs only to routes discovered by this plugin and
// still configured for that exact loopback Strata model. Never inspect secrets
// for other routes, and never repair or replace an existing record/reference.
const KEY_SEGMENT = /^[a-z][a-z0-9-]*$/;

function localEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) return null;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

export async function reconcileManagedCredentials(controller, { llm, credentials, settings, isActive = () => true }) {
  if (!isActive() || !controller.getEnv().compatible) return;
  const routes = new Set(llm.listProviders().map(route => route.id));
  const directory = llm.listConfigurableProviders();
  for (const managed of controller.discoverModels()) {
    const provider = managed.provider;
    const endpoint = localEndpoint(managed.endpoint);
    if (!KEY_SEGMENT.test(provider) || !endpoint || !routes.has(provider)) continue;
    const entry = directory.find(item => item.provider === provider);
    if (!entry?.declared || entry.settingsNs !== 'llm-pi-ai' || entry.error || entry.settingsPath?.length !== 2
      || entry.settingsPath[0] !== 'providers' || entry.settingsPath[1] !== provider) continue;
    const stillManaged = () => {
      const section = settings.describe({ redactSecrets: true }).find(item => item.ns === entry.settingsNs)?.value;
      const profile = section?.providers?.[provider];
      return profile && profile.api === 'openai-completions' && profile.apiKeyEnv === undefined
        && localEndpoint(profile.baseURL) === endpoint
        && profile.models?.some(model => model.id === managed.model);
    };
    if (!stillManaged()) continue;
    // Directory + live effective profile establish ownership/address; the model
    // catalog confirms registration has completed without issuing inference.
    const models = await llm.listModels(provider);
    if (!models.some(model => model.id === managed.model)) continue;
    const key = `llm-pi-ai/${provider}`;
    if (await credentials.readRecord(key) !== undefined || !isActive()) continue;
    await credentials.modifyRecord(key, async current => current === undefined && isActive() && stillManaged()
      ? { kind: 'api-key', key: 'local' } : undefined);
  }
}
