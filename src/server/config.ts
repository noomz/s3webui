const requiredEnv = (key: string, fallback?: string) => {
  const value = process.env[key] || fallback;
  if (!value) throw new Error(`Missing env ${key}`);
  return value;
};

export const serverConfig = {
  accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID", process.env.VITE_AWS_ACCESS_KEY_ID),
  secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY", process.env.VITE_AWS_SECRET_ACCESS_KEY),
  sessionToken: process.env.AWS_SESSION_TOKEN || process.env.VITE_AWS_SESSION_TOKEN || "",
  region: requiredEnv("AWS_REGION", process.env.VITE_AWS_REGION),
  bucket: requiredEnv("S3_BUCKET", process.env.VITE_S3_BUCKET),
  defaultObjectAcl: process.env.DEFAULT_OBJECT_ACL || process.env.VITE_DEFAULT_OBJECT_ACL || "private",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.VITE_PUBLIC_BASE_URL,
  signedUrlTtl: Number(process.env.SIGNED_URL_TTL || process.env.VITE_SIGNED_URL_TTL || 3600),
  adminSecret: requiredEnv("ADMIN_SECRET"),
  jwtSecret: requiredEnv("JWT_SECRET"),
};

export const objectsPublicByDefault = (serverConfig.defaultObjectAcl || "")
  .toLowerCase()
  .includes("public-read");
