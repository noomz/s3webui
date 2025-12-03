const TOKEN_KEY = "s3webui:token";

export const auth = {
  get token() {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(TOKEN_KEY) || "";
  },
  set token(value: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(TOKEN_KEY, value);
  },
  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(TOKEN_KEY);
  },
};

export const authorizedFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {});
  if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    auth.clear();
  }
  return res;
};
