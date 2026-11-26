import {
  GAS_ACTION_POLICIES,
  RepositoryError,
  type GasRpcAction,
  type UserRole,
  type UserSession,
} from '@app-icol/shared';

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VALID_GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

export interface AuthConfig {
  googleClientId: string;
  managerEmails: ReadonlySet<string>;
  contributorEmails: ReadonlySet<string>;
  allowMockGisTokens: boolean;
}

export interface GoogleTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  exp?: number | string;
  iat?: number | string;
}

interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
}

export function parseEmailAllowlist(raw: string | null | undefined): Set<string> {
  const result = new Set<string>();
  if (!raw) return result;
  for (const part of raw.split(/[,;\n\r\s]+/)) {
    const cleaned = part.trim().toLowerCase();
    if (cleaned && cleaned.includes('@')) {
      result.add(cleaned);
    }
  }
  return result;
}

/**
 * Pure ES2020 Base64URL -> UTF-8 string decoder (works identically in GAS V8 and Node without Buffer/atob).
 */
export function decodeBase64UrlUtf8(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (normalized.length % 4 === 1) {
    throw new Error('Invalid base64url length');
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (let i = 0; i < normalized.length; i++) {
    const val = BASE64_ALPHABET.indexOf(normalized[i]!);
    if (val === -1) {
      throw new Error('Invalid base64url character');
    }
    buffer = (buffer << 6) | val;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  // Decode UTF-8 byte sequence to Unicode string
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if ((b0 & 0x80) === 0) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0) {
      if (i >= bytes.length) throw new Error('Truncated UTF-8 sequence');
      const b1 = bytes[i++]!;
      const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      out += String.fromCodePoint(cp);
    } else if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= bytes.length) throw new Error('Truncated UTF-8 sequence');
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      out += String.fromCodePoint(cp);
    } else if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= bytes.length) throw new Error('Truncated UTF-8 sequence');
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      const b3 = bytes[i++]!;
      const cp =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      out += String.fromCodePoint(cp);
    } else {
      throw new Error('Invalid UTF-8 leading byte');
    }
  }
  return out;
}

function hashTokenForCache(token: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}_${token.length}`;
}

export function loadAuthConfigFromScriptProperties(): AuthConfig {
  if (typeof PropertiesService === 'undefined' || !PropertiesService?.getScriptProperties) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'PropertiesService indisponible dans cet environnement Apps Script.',
    );
  }

  const scriptProps = PropertiesService.getScriptProperties();
  const googleClientId = (scriptProps.getProperty('GOOGLE_CLIENT_ID') ?? '').trim();
  const managerEmails = parseEmailAllowlist(scriptProps.getProperty('MANAGER_EMAILS'));
  const contributorEmails = parseEmailAllowlist(
    scriptProps.getProperty('CONTRIBUTOR_EMAILS'),
  );
  const allowMockGisTokens =
    (scriptProps.getProperty('ALLOW_MOCK_GIS_TOKENS') ?? '').trim().toLowerCase() ===
    'true';

  if (managerEmails.size === 0 && contributorEmails.size === 0) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'Configuration incomplète : définissez MANAGER_EMAILS (et optionnellement CONTRIBUTOR_EMAILS) dans les Propriétés du script.',
    );
  }

  return {
    googleClientId,
    managerEmails,
    contributorEmails,
    allowMockGisTokens,
  };
}

function tryDecodeMockGisJwt(idToken: string): GoogleTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new RepositoryError('UNAUTHENTICATED', 'Format de jeton JWT Google invalide.');
  }

  let header: JwtHeader;
  let payload: GoogleTokenClaims;
  try {
    header = JSON.parse(decodeBase64UrlUtf8(parts[0])) as JwtHeader;
    payload = JSON.parse(decodeBase64UrlUtf8(parts[1])) as GoogleTokenClaims;
  } catch {
    throw new RepositoryError('UNAUTHENTICATED', 'Jeton JWT Google illisible ou corrompu.');
  }

  if (header?.kid === 'app-icol-mock-kid') {
    return payload;
  }
  return null;
}

function fetchGoogleTokenInfoClaims(idToken: string): GoogleTokenClaims {
  const cacheAvailable =
    typeof CacheService !== 'undefined' && Boolean(CacheService?.getScriptCache);
  const cacheKey = `app-icol:tok:${hashTokenForCache(idToken)}`;

  if (cacheAvailable) {
    try {
      const cachedRaw = CacheService.getScriptCache().get(cacheKey);
      if (cachedRaw) {
        return JSON.parse(cachedRaw) as GoogleTokenClaims;
      }
    } catch {
      // Ignore cache read error and verify online
    }
  }

  if (typeof UrlFetchApp === 'undefined' || !UrlFetchApp?.fetch) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Impossible de valider le jeton Google Identity Services (UrlFetchApp indisponible).',
    );
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
    });
  } catch (err) {
    throw new RepositoryError(
      'NETWORK_ERROR',
      'Échec de vérification du jeton auprès de Google OAuth2.',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (response.getResponseCode() !== 200) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Jeton Google Identity Services invalide ou expiré.',
    );
  }

  let claims: GoogleTokenClaims;
  try {
    claims = JSON.parse(response.getContentText()) as GoogleTokenClaims;
  } catch {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Réponse tokeninfo Google OAuth2 invalide.',
    );
  }

  if (cacheAvailable && claims.exp !== undefined) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = Number(claims.exp);
    const ttl = Number.isFinite(expSec) ? Math.min(300, Math.max(0, expSec - nowSec - 5)) : 0;
    if (ttl > 5) {
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(claims), ttl);
      } catch {
        // Ignore cache write error
      }
    }
  }

  return claims;
}

export function validateClaimsAndResolveSession(
  claims: GoogleTokenClaims,
  config: AuthConfig,
  nowMs: number = Date.now(),
): UserSession {
  const iss = typeof claims.iss === 'string' ? claims.iss.trim() : '';
  if (!VALID_GOOGLE_ISSUERS.has(iss)) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Émetteur (iss) du jeton Google non reconnu.',
    );
  }

  if (config.googleClientId) {
    const aud = typeof claims.aud === 'string' ? claims.aud.trim() : '';
    if (aud !== config.googleClientId) {
      throw new RepositoryError(
        'UNAUTHENTICATED',
        'Audience (aud) du jeton Google non autorisée pour cette application.',
      );
    }
  }

  const expSec = Number(claims.exp);
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isFinite(expSec) || expSec <= nowSec) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Votre session Google a expiré. Veuillez vous reconnecter.',
    );
  }

  const emailVerified =
    claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      "L'adresse e-mail du compte Google n'est pas vérifiée.",
    );
  }

  const rawEmail = typeof claims.email === 'string' ? claims.email.trim() : '';
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Aucune adresse e-mail valide trouvée dans le jeton Google.',
    );
  }

  const normalizedEmail = rawEmail.toLowerCase();
  let role: UserRole | null = null;
  if (config.managerEmails.has(normalizedEmail)) {
    role = 'manager';
  } else if (config.contributorEmails.has(normalizedEmail)) {
    role = 'contributor';
  }

  if (!role) {
    throw new RepositoryError(
      'FORBIDDEN_ROLE',
      `Accès refusé : le compte "${rawEmail}" n'est pas autorisé à accéder à ce rucher.`,
      { email: rawEmail },
    );
  }

  const displayName =
    typeof claims.name === 'string' && claims.name.trim().length > 0
      ? claims.name.trim()
      : rawEmail.split('@')[0] || rawEmail;

  return {
    email: rawEmail,
    displayName,
    role,
  };
}

/**
 * Verifies the GIS `idToken` against Google tokeninfo (or local mock JWT when ALLOW_MOCK_GIS_TOKENS=true)
 * and resolves the caller's role from MANAGER_EMAILS / CONTRIBUTOR_EMAILS.
 */
export function verifyIdTokenSession(
  idToken: string | undefined | null,
  configOverride?: AuthConfig,
): UserSession {
  const config = configOverride ?? loadAuthConfigFromScriptProperties();

  const trimmedToken = typeof idToken === 'string' ? idToken.trim() : '';
  if (!trimmedToken) {
    throw new RepositoryError(
      'UNAUTHENTICATED',
      'Authentification Google requise (idToken manquant).',
    );
  }

  let claims: GoogleTokenClaims | null = null;
  if (config.allowMockGisTokens) {
    claims = tryDecodeMockGisJwt(trimmedToken);
  }
  if (!claims) {
    claims = fetchGoogleTokenInfoClaims(trimmedToken);
  }

  return validateClaimsAndResolveSession(claims, config);
}

/**
 * Enforces GAS_ACTION_POLICIES role-based access control (rejecting contributor calls to
 * manager-only actions including orders.delete, harvests.*, formats.upsert, accounting.*, admin.*).
 */
export function assertRoleAllowedForAction(
  session: UserSession,
  action: GasRpcAction,
): void {
  const policy = GAS_ACTION_POLICIES[action];
  if (!policy.allowedRoles.includes(session.role)) {
    throw new RepositoryError(
      'FORBIDDEN_ROLE',
      `Action "${action}" réservée au gestionnaire du rucher.`,
      { action, role: session.role },
    );
  }
}

/**
 * End-to-end authentication + RBAC verification for an incoming GAS RPC call.
 */
export function authenticateAndAuthorizeRpc(
  idToken: string | undefined | null,
  action: GasRpcAction,
  configOverride?: AuthConfig,
): UserSession {
  const session = verifyIdTokenSession(idToken, configOverride);
  assertRoleAllowedForAction(session, action);
  return session;
}
