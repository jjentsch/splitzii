export async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Please try again.");
  return result.data as T;
}
