import { viewUri } from "@dwidge/expo-export-uri";
import React, { useState } from "react";
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Expandable } from "./Expandable";
import { useFileCache2Uri, usePickFileUri } from "./FileCacheProvider";
import { getDataUriFromFileUri } from "./getDataUriFromFileUri";
import {
  useCacheErrorsRecord,
  useCacheFileIds,
  useClearCacheError,
  useClearUploadError,
  useErrorFileIds,
  useFileCache,
  useGetFileRecord,
  useGetSignedUrls,
  useMissingFileIds,
  usePendingFileIds,
  useRecentFileIds,
  useUploadErrorsRecord,
} from "./provider";
import { DataUri, FileId, FileMeta, FileRecord } from "./types";
import {
  asFileUri,
  getMimeTypeFromDataUri,
  getSha256HexFromDataUri,
  getSizeFromDataUri,
} from "./uri";
import { UserError } from "./UserError.js";

interface FileDetailsProps {
  fileId: FileId;
  dataUri?: DataUri | null;
  setDataUri?: (uri: DataUri | null) => Promise<DataUri | null>;
  meta?: Partial<FileMeta>;
  record?: Partial<FileRecord>;
  urls?: { getUrl?: string | null; putUrl?: string | null } | null;
  errorMessage?: string;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onClearError?: (id: FileId) => void;
  onManualUpload?: (id: FileId, dataUri: DataUri) => Promise<void>;
  onOpenGetUrl?: (url: string) => void;
}

const FileDetailsInline: React.FC<FileDetailsProps> = ({
  fileId,
  dataUri,
  setDataUri,
  meta = { size: null, mime: null, sha256: null },
  record,
  urls = { getUrl: null, putUrl: null },
  errorMessage,
  onRetryUpload,
  onRetryFetch,
  onClearError,
  onManualUpload,
  onOpenGetUrl,
}) => {
  const pickFileUri = usePickFileUri();
  const handleOpenGetUrl = () => {
    if (urls?.getUrl && urls.getUrl !== null) {
      onOpenGetUrl?.(urls.getUrl);
    }
  };

  const handleRetryPickClick = async () => {
    if (
      !pickFileUri ||
      !onManualUpload ||
      !urls?.putUrl ||
      urls.putUrl === null ||
      meta.size == null ||
      meta.sha256 == null ||
      meta.mime == null
    ) {
      throw new UserError("Retry not available");
    }

    if (meta.size == null || meta.sha256 == null || meta.mime == null) {
      throw new UserError("Invalid meta");
    }

    const [uri] = await pickFileUri();
    if (!uri) return;
    const dataUri: DataUri = await getDataUriFromFileUri(asFileUri(uri));

    const pickedSize = getSizeFromDataUri(dataUri);
    const pickedMime = getMimeTypeFromDataUri(dataUri);
    const computedHash = await getSha256HexFromDataUri(dataUri);

    if (pickedSize !== meta.size) {
      throw new UserError(
        `Size Mismatch: Expected size: ${meta.size}, Picked: ${pickedSize}. File does not match.`,
      );
    }

    if (computedHash !== meta.sha256) {
      throw new UserError(
        `Hash Mismatch: Expected SHA256: ${meta.sha256}, Computed: ${computedHash}. File does not match.`,
      );
    }

    if (pickedMime !== meta.mime) {
      throw new UserError(
        `MIME Mismatch: Expected MIME: ${meta.mime}, Picked: ${pickedMime}. File does not match.`,
      );
    }

    await onManualUpload(fileId, dataUri);
  };

  const handleChangeFileClick =
    setDataUri && pickFileUri
      ? async () => {
          const [uri] = await pickFileUri();
          if (uri)
            await setDataUri(await getDataUriFromFileUri(asFileUri(uri)));
        }
      : undefined;

  const handleDeleteClick = setDataUri
    ? async () => {
        await setDataUri(null);
      }
    : undefined;

  const isGetUrlDisabled = !(urls?.getUrl && urls.getUrl !== null);
  const isPutUrlDisabled =
    !pickFileUri ||
    !urls?.putUrl ||
    urls.putUrl === null ||
    meta.size == null ||
    meta.sha256 == null ||
    meta.mime == null ||
    !onManualUpload;
  const isChangeDisabled = !setDataUri || !pickFileUri;
  const isDeleteDisabled = !setDataUri;

  return (
    <View style={styles.fileDetails}>
      <Text style={styles.detailsTitle}>File Details: {fileId}</Text>
      <Text>File ID: {fileId}</Text>
      {record && (
        <View style={styles.metaContainer}>
          <Text style={styles.metaTitle}>Record Meta:</Text>
          <Text>Size: {record.size ?? "N/A"}</Text>
          <Text>MIME: {record.mime ?? "N/A"}</Text>
          <Text>
            SHA256:{" "}
            {record.sha256 ? `${record.sha256.substring(0, 16)}...` : "N/A"}
          </Text>
          {record.createdAt && (
            <Text>
              Created: {new Date(record.createdAt * 1000).toISOString()}
            </Text>
          )}
          {record.updatedAt && (
            <Text>
              Updated: {new Date(record.updatedAt * 1000).toISOString()}
            </Text>
          )}
          {record.deletedAt && (
            <Text>
              Deleted: {new Date(record.deletedAt * 1000).toISOString()}
            </Text>
          )}
        </View>
      )}
      {errorMessage && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {errorMessage}</Text>
          {onClearError ? (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => onClearError(fileId)}
            >
              <Text>Clear Error</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <Text>
        Data URI: {dataUri ? `${dataUri.length} chars` : "No data cached"}
      </Text>
      {dataUri && dataUri.startsWith("data:image/") && (
        <Image
          source={{ uri: dataUri }}
          style={{ width: 200, height: 200, marginVertical: 10 }}
        />
      )}
      <TouchableOpacity
        style={[styles.button, isGetUrlDisabled && styles.disabledButton]}
        onPress={handleOpenGetUrl}
        disabled={isGetUrlDisabled}
      >
        <Text
          style={[styles.buttonText, isGetUrlDisabled && styles.disabledText]}
        >
          Open Get URL
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, isPutUrlDisabled && styles.disabledButton]}
        onPress={handleRetryPickClick}
        disabled={isPutUrlDisabled}
      >
        <Text
          style={[styles.buttonText, isPutUrlDisabled && styles.disabledText]}
        >
          Pick Matching File
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, isChangeDisabled && styles.disabledButton]}
        onPress={handleChangeFileClick}
        disabled={isChangeDisabled}
      >
        <Text
          style={[styles.buttonText, isChangeDisabled && styles.disabledText]}
        >
          Change File (update meta)
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, isDeleteDisabled && styles.disabledButton]}
        onPress={handleDeleteClick}
        disabled={isDeleteDisabled}
      >
        <Text
          style={[styles.buttonText, isDeleteDisabled && styles.disabledText]}
        >
          Delete File (null meta)
        </Text>
      </TouchableOpacity>
      {dataUri && (
        <TouchableOpacity
          style={styles.button}
          onPress={() => viewUri(dataUri, fileId)}
        >
          <Text style={styles.buttonText}>Download/View Cached File</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.button}
        onPress={() => onRetryUpload(fileId, dataUri ?? undefined)}
      >
        <Text style={styles.buttonText}>Retry Upload</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.button}
        onPress={() => onRetryFetch(fileId)}
      >
        <Text style={styles.buttonText}>Retry Fetch</Text>
      </TouchableOpacity>
    </View>
  );
};

interface FileItemProps {
  fileId: FileId;
  errorMessage?: string;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onClearError?: (id: FileId) => void;
  onManualUpload?: (id: FileId, dataUri: DataUri) => Promise<void>;
  showRetry?: boolean;
}

const FileItem: React.FC<FileItemProps> = ({
  fileId,
  errorMessage,
  onRetryUpload,
  onRetryFetch,
  onClearError,
  onManualUpload,
  showRetry = false,
}) => {
  const getFileRecord = useGetFileRecord();
  const getSignedUrls = useGetSignedUrls();
  const [dataUri, setDataUri] = useFileCache2Uri(fileId, {
    setFiles: useFileCache().setFiles,
  }) ?? [undefined, undefined];
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState<Partial<FileMeta>>({});
  const [record, setRecord] = useState<Partial<FileRecord>>({});
  const [urls, setUrls] = useState<{
    getUrl?: string | null;
    putUrl?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (!expanded) {
      setLoading(true);
      setLoadError(null);
      try {
        const [rec, urlObj] = await Promise.allSettled([
          getFileRecord ? getFileRecord(fileId) : Promise.resolve(undefined),
          getSignedUrls ? getSignedUrls(fileId) : Promise.resolve(null),
        ]);

        if (rec.status === "fulfilled" && rec.value) {
          const r = rec.value;
          setRecord(r);
          setMeta({
            size: r.size ?? undefined,
            mime: r.mime ?? undefined,
            sha256: r.sha256 ?? undefined,
          });
        }

        if (urlObj.status === "fulfilled") {
          const urlValue = urlObj.value;
          if (urlValue) {
            setUrls({
              getUrl: urlValue.getUrl ?? null,
              putUrl: urlValue.putUrl ?? null,
            });
          } else {
            setUrls(null);
          }
        }
      } catch (error) {
        console.error("Error loading file details:", error);
        setLoadError(`${error}`);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleOpenGetUrl = (url: string) => {
    Linking.openURL(url).catch(console.error);
  };

  if (loading && !expanded) {
    return (
      <Expandable
        title={fileId}
        expanded={false}
        onToggle={() => {}}
        children={<Text>Loading summary...</Text>}
      />
    );
  }

  return (
    <Expandable
      title={`${fileId} ${errorMessage ? `(Error: ${errorMessage.substring(0, 30)}...)` : ""}`}
      expanded={expanded}
      onToggle={handleToggle}
      children={
        loading ? (
          <Text>Loading details...</Text>
        ) : loadError ? (
          <Text>Error loading details: {loadError}</Text>
        ) : (
          <FileDetailsInline
            fileId={fileId}
            dataUri={dataUri}
            setDataUri={setDataUri}
            meta={meta}
            record={record}
            urls={urls}
            errorMessage={errorMessage}
            onRetryUpload={onRetryUpload}
            onRetryFetch={onRetryFetch}
            onClearError={onClearError}
            onManualUpload={onManualUpload}
            onOpenGetUrl={handleOpenGetUrl}
          />
        )
      }
    />
  );
};

interface ExpandableSectionProps {
  title: string;
  fileIds: FileId[] | undefined;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onClearError?: (id: FileId) => void;
  onManualUpload?: (id: FileId, dataUri: DataUri) => Promise<void>;
  showRetry?: boolean;
  expanded: boolean;
  onToggle: () => void;
}

const ExpandableSection: React.FC<ExpandableSectionProps> = ({
  title,
  fileIds,
  onRetryUpload,
  onRetryFetch,
  onClearError,
  onManualUpload,
  showRetry = false,
  expanded,
  onToggle,
}) => {
  const count = Array.isArray(fileIds) ? fileIds.length : 0;

  return (
    <Expandable
      title={`${title} (${count})`}
      expanded={expanded}
      onToggle={onToggle}
      children={
        fileIds && fileIds.length > 0 ? (
          fileIds.map((id) => (
            <FileItem
              key={id}
              fileId={id}
              onRetryUpload={onRetryUpload}
              onRetryFetch={onRetryFetch}
              onClearError={onClearError}
              onManualUpload={onManualUpload}
              showRetry={showRetry}
            />
          ))
        ) : (
          <Text>No files</Text>
        )
      }
    />
  );
};

interface ErrorsSectionProps {
  title: string;
  errors: Record<FileId, string>;
  onClearError?: (id: FileId) => void;
  onRetry: (id: FileId) => Promise<void>;
  onManualUpload?: (id: FileId, dataUri: DataUri) => Promise<void>;
  expanded: boolean;
  onToggle: () => void;
}

const ErrorsSection: React.FC<ErrorsSectionProps> = ({
  title,
  errors,
  onClearError,
  onRetry,
  onManualUpload,
  expanded,
  onToggle,
}) => {
  const errorIds = Object.keys(errors);
  const count = errorIds.length;

  const handleRetryError = async (id: FileId) => {
    await onRetry(id);
  };

  return (
    <Expandable
      title={`${title} (${count})`}
      expanded={expanded}
      onToggle={onToggle}
      children={
        errorIds.length > 0 ? (
          errorIds.map((id) => (
            <FileItem
              key={id}
              fileId={id}
              errorMessage={errors[id]}
              onClearError={onClearError}
              onRetryUpload={handleRetryError}
              onRetryFetch={handleRetryError}
              onManualUpload={onManualUpload}
            />
          ))
        ) : (
          <Text>No errors</Text>
        )
      }
    />
  );
};

export const FileCacheDiagnostic: React.FC = () => {
  const [cacheExpanded, setCacheExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [missingExpanded, setMissingExpanded] = useState(false);
  const [cacheErrorsExpanded, setCacheErrorsExpanded] = useState(false);
  const [uploadErrorsExpanded, setUploadErrorsExpanded] = useState(false);

  const { sync, reset, refreshNonPending, uploadFile } = useFileCache();

  const clearCacheError = useClearCacheError();
  const clearUploadError = useClearUploadError();
  const cacheErrors = useCacheErrorsRecord();
  const uploadErrors = useUploadErrorsRecord();
  const cacheIds = useCacheFileIds();
  const pendingIds = usePendingFileIds();
  const errorIds = useErrorFileIds();
  const recentIds = useRecentFileIds();
  const missingIds = useMissingFileIds();

  const handleRetryUpload = async (id: FileId, uri?: DataUri) => {
    console.log("Retry upload for", id, uri);
    await sync?.({ concurrency: 1 });
  };

  const handleRetryFetch = async (id: FileId) => {
    console.log("Retry fetch for", id);
    await refreshNonPending?.([id]);
  };

  const handleRetryError = async (id: FileId) => {
    console.log("Retry for errored file", id);
    await sync?.({ concurrency: 1 });
    await refreshNonPending?.([id]);
  };

  const handleManualUpload = async (id: FileId, dataUri: DataUri) => {
    if (uploadFile) {
      await uploadFile(id, dataUri);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>File Cache Diagnostic</Text>
      <TouchableOpacity
        style={styles.actionButton}
        disabled={!sync}
        onPress={() => sync?.()}
      >
        <Text style={styles.buttonText}>Sync Cache</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionButton}
        disabled={!reset}
        onPress={() => reset?.()}
      >
        <Text style={styles.buttonText}>Reset Cache</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionButton}
        disabled={!refreshNonPending}
        onPress={() => refreshNonPending?.()}
      >
        <Text style={styles.buttonText}>Refresh Non-Pending</Text>
      </TouchableOpacity>
      <ExpandableSection
        title="Download Cache"
        fileIds={Array.isArray(cacheIds) ? cacheIds : []}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onClearError={clearCacheError}
        onManualUpload={handleManualUpload}
        expanded={cacheExpanded}
        onToggle={() => setCacheExpanded(!cacheExpanded)}
      />
      <ExpandableSection
        title="Upload Cache"
        fileIds={Array.isArray(pendingIds) ? pendingIds : []}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onClearError={clearUploadError}
        onManualUpload={handleManualUpload}
        showRetry={true}
        expanded={pendingExpanded}
        onToggle={() => setPendingExpanded(!pendingExpanded)}
      />
      <ExpandableSection
        title="Upload Backup Cache"
        fileIds={Array.isArray(errorIds) ? errorIds : []}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onClearError={clearUploadError}
        onManualUpload={handleManualUpload}
        showRetry={true}
        expanded={errorExpanded}
        onToggle={() => setErrorExpanded(!errorExpanded)}
      />
      <ExpandableSection
        title="Missing Files"
        fileIds={Array.isArray(missingIds) ? missingIds : []}
        onRetryUpload={async () => {}}
        onRetryFetch={handleRetryFetch}
        onClearError={undefined}
        onManualUpload={handleManualUpload}
        expanded={missingExpanded}
        onToggle={() => setMissingExpanded(!missingExpanded)}
      />
      <ExpandableSection
        title="Recent Files"
        fileIds={Array.isArray(recentIds) ? recentIds : []}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onClearError={clearCacheError}
        onManualUpload={handleManualUpload}
        expanded={recentExpanded}
        onToggle={() => setRecentExpanded(!recentExpanded)}
      />
      <ErrorsSection
        title="Download Errors"
        errors={cacheErrors}
        onClearError={clearCacheError}
        onRetry={handleRetryError}
        onManualUpload={handleManualUpload}
        expanded={cacheErrorsExpanded}
        onToggle={() => setCacheErrorsExpanded(!cacheErrorsExpanded)}
      />
      <ErrorsSection
        title="Upload Errors"
        errors={uploadErrors}
        onClearError={clearUploadError}
        onRetry={handleRetryError}
        onManualUpload={handleManualUpload}
        expanded={uploadErrorsExpanded}
        onToggle={() => setUploadErrorsExpanded(!uploadErrorsExpanded)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
    backgroundColor: "#ddd",
    borderColor: "#454545ff",
    borderWidth: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  actionButton: {
    backgroundColor: "#ddd",
    padding: 15,
    marginVertical: 5,
    borderRadius: 5,
    borderColor: "#454545ff",
    borderWidth: 1,
  },
  buttonText: {
    textAlign: "center",
    fontSize: 16,
  },
  fileDetails: {
    padding: 10,
  },
  detailsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  metaContainer: {
    backgroundColor: "#e8f5e8",
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
    borderColor: "#4caf50",
    borderWidth: 1,
  },
  metaTitle: {
    fontWeight: "bold",
    marginBottom: 5,
  },
  errorContainer: {
    backgroundColor: "#ffebee",
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
    borderColor: "#f44336",
    borderWidth: 1,
  },
  errorText: {
    color: "#d32f2f",
    marginBottom: 5,
  },
  button: {
    backgroundColor: "#ddd",
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
    borderColor: "#454545ff",
    borderWidth: 1,
  },
  disabledButton: {
    backgroundColor: "#ccc",
    opacity: 0.5,
  },
  disabledText: {
    color: "#999",
  },
  clearButton: {
    backgroundColor: "#fff3e0",
    padding: 8,
    marginVertical: 3,
    borderRadius: 5,
    borderColor: "#ff9800",
    borderWidth: 1,
  },
});
