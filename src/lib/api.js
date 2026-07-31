/**
 * Schmaler Wrapper um fetch für das NestJS-Backend.
 * Kennt nur Transport und Fehlerformat — keine React-Abhängigkeit.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TOKEN_KEY = "abc-auth-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** status 0 bedeutet: Anfrage kam nie beim Server an. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Nest liefert bei Validierungsfehlern ein Array in `message`, sonst einen String. */
function readMessage(data, status) {
  if (Array.isArray(data?.message)) return data.message.join(". ");
  if (typeof data?.message === "string") return data.message;
  return `Request failed (${status})`;
}

/**
 * fetch wirft bei totem Server UND bei CORS-Blockade denselben TypeError —
 * der Browser verrät den Grund aus Sicherheitsgründen nicht. Deshalb beide
 * Möglichkeiten nennen, sonst sucht man am falschen Ende.
 */
function unreachableError() {
  return new ApiError(
    0,
    `Cannot reach ${BASE_URL}. Either the backend is not running, ` +
      `or it rejects requests from ${window.location.origin} (check CORS_ORIGIN).`,
  );
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  // FormData bekommt bewusst KEIN Content-Type: der Browser setzt ihn selbst,
  // inklusive der zufälligen boundary, die den multipart-Body zerlegt. Setzt
  // man den Header von Hand, fehlt die boundary und der Server findet nichts.
  const isFormData = body instanceof FormData;

  const headers = {
    ...(body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...(auth ? authHeader() : {}),
  };

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch {
    throw unreachableError();
  }

  // 204 hat per Definition keinen Body (z.B. DELETE /auth/account).
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, readMessage(data, res.status));
  return data;
}

/**
 * Holt Binärdaten (Audio) statt JSON. Nötig, weil der Endpunkt einen Token
 * verlangt — eine geschützte URL lässt sich nicht einfach als src verwenden.
 */
export async function apiFetchBlob(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: authHeader() });
  } catch {
    throw unreachableError();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, readMessage(data, res.status));
  }
  return await res.blob();
}
