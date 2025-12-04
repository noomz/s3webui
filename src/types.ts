export type PermissionKey =
  | "list"
  | "createFolder"
  | "upload"
  | "delete"
  | "copyLink"
  | "copySignedUrl";

export type User = {
  id: string;
  name: string;
  permissions: Record<PermissionKey, boolean>;
};

export type S3Folder = {
  name: string;
  prefix: string;
};

export type S3ObjectSummary = {
  key: string;
  size: number;
  lastModified?: string;
};

export type BucketMeta = {
  bucket: string;
  region: string;
  defaultAcl: string;
  publicByDefault: boolean;
};

export type AuthState = {
  token: string;
  authenticated: boolean;
};

export type IndexStatus = {
  objectCount: number;
  lastFullScan: string | null;
  lastDeltaScan: string | null;
};

export type IndexedObject = {
  key: string;
  name: string;
  extension: string | null;
  size: number;
  lastModified: string | null;
  updatedAt: string;
  type: "file" | "folder";
};
