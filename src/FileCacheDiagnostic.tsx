import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Expandable } from "./Expandable";
import {
  useCacheErrorsRecord,
  useCacheFileIds,
  useClearCacheError,
  useClearUploadError,
  useErrorFileIds,
  useFileCache,
  usePendingFileIds,
  useRecentFileIds,
  useUploadErrorsRecord,
} from "./provider";
import { DataUri, FileId } from "./types";

interface FileDetailsProps {
  fileId: FileId;
  dataUri: DataUri | null;
  errorMessage?: string;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onDownload: (uri: DataUri) => Promise<void>;
  onClearError?: (id: FileId) => void;
}

const FileDetailsInline: React.FC<FileDetailsProps> = ({
  fileId,
  dataUri,
  errorMessage,
  onRetryUpload,
  onRetryFetch,
  onDownload,
  onClearError,
}) => (
  <View style={styles.fileDetails}>
    <Text style={styles.detailsTitle}>File Details: {fileId}</Text>
    <Text>File ID: {fileId}</Text>
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
    {dataUri && (
      <>
        <Text>Data URI Length: {dataUri.length}</Text>
        {dataUri.startsWith("data:image/") && (
          <Image
            source={{ uri: dataUri }}
            style={{ width: 200, height: 200, marginVertical: 10 }}
          />
        )}
        <TouchableOpacity
          style={styles.button}
          onPress={() => onDownload(dataUri)}
        >
          <Text>Download/View File</Text>
        </TouchableOpacity>
      </>
    )}
    {dataUri && (
      <TouchableOpacity
        style={styles.button}
        onPress={() => onRetryUpload(fileId, dataUri)}
      >
        <Text>Retry Upload</Text>
      </TouchableOpacity>
    )}
    <TouchableOpacity
      style={styles.button}
      onPress={() => onRetryFetch(fileId)}
    >
      <Text>Retry Fetch</Text>
    </TouchableOpacity>
  </View>
);

interface FileItemProps {
  fileId: FileId;
  getDataUri: (id: FileId) => Promise<DataUri | null | undefined>;
  errorMessage?: string;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onDownload: (uri: DataUri) => Promise<void>;
  onClearError?: (id: FileId) => void;
  showRetry?: boolean;
}

const FileItem: React.FC<FileItemProps> = ({
  fileId,
  getDataUri,
  errorMessage,
  onRetryUpload,
  onRetryFetch,
  onDownload,
  onClearError,
  showRetry = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [dataUri, setDataUri] = useState<DataUri | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!expanded && !dataUri) {
      setLoading(true);
      try {
        const uri = await getDataUri(fileId);
        setDataUri((uri ?? null) as DataUri | null);
      } catch (error) {
        console.error("Error loading file URI:", error);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <Expandable
      title={fileId}
      expanded={expanded}
      onToggle={handleToggle}
      children={
        loading ? (
          <Text>Loading...</Text>
        ) : (
          <FileDetailsInline
            fileId={fileId}
            dataUri={dataUri}
            errorMessage={errorMessage}
            onRetryUpload={onRetryUpload}
            onRetryFetch={onRetryFetch}
            onDownload={onDownload}
            onClearError={onClearError}
          />
        )
      }
    />
  );
};

interface ErrorItemProps {
  fileId: FileId;
  errorMessage: string;
  onClearError?: (id: FileId) => void;
  onRetry: (id: FileId) => Promise<void>;
}

const ErrorItem: React.FC<ErrorItemProps> = ({
  fileId,
  errorMessage,
  onClearError,
  onRetry,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Expandable
      title={`${fileId}: ${errorMessage.substring(0, 50)}${errorMessage.length > 50 ? "..." : ""}`}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      children={
        <View style={styles.errorDetails}>
          <Text style={styles.errorText}>Full Error: {errorMessage}</Text>
          {onClearError ? (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => onClearError(fileId)}
            >
              <Text>Clear Error</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => onRetry(fileId)}
          >
            <Text>Retry Operation</Text>
          </TouchableOpacity>
        </View>
      }
    />
  );
};

interface ExpandableSectionProps {
  title: string;
  fileIds: FileId[] | undefined;
  getDataUri: (id: FileId) => Promise<DataUri | null | undefined>;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onDownload: (uri: DataUri) => Promise<void>;
  onClearError?: (id: FileId) => void;
  showRetry?: boolean;
  expanded: boolean;
  onToggle: () => void;
}

const ExpandableSection: React.FC<ExpandableSectionProps> = ({
  title,
  fileIds,
  getDataUri,
  onRetryUpload,
  onRetryFetch,
  onDownload,
  onClearError,
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
              getDataUri={getDataUri}
              onRetryUpload={onRetryUpload}
              onRetryFetch={onRetryFetch}
              onDownload={onDownload}
              onClearError={onClearError}
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
  expanded: boolean;
  onToggle: () => void;
}

const ErrorsSection: React.FC<ErrorsSectionProps> = ({
  title,
  errors,
  onClearError,
  onRetry,
  expanded,
  onToggle,
}) => {
  const errorIds = Object.keys(errors);
  const count = errorIds.length;

  return (
    <Expandable
      title={`${title} (${count})`}
      expanded={expanded}
      onToggle={onToggle}
      children={
        errorIds.length > 0 ? (
          errorIds.map((id) => (
            <ErrorItem
              key={id}
              fileId={id}
              errorMessage={errors[id]}
              onClearError={onClearError}
              onRetry={onRetry}
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
  const [cacheErrorsExpanded, setCacheErrorsExpanded] = useState(false);
  const [uploadErrorsExpanded, setUploadErrorsExpanded] = useState(false);

  const { sync, reset, refreshNonPending, getItem } = useFileCache();
  const clearCacheError = useClearCacheError();
  const clearUploadError = useClearUploadError();
  const cacheErrors = useCacheErrorsRecord();
  const uploadErrors = useUploadErrorsRecord();
  const cacheIds = useCacheFileIds();
  const pendingIds = usePendingFileIds();
  const errorIds = useErrorFileIds();
  const recentIds = useRecentFileIds();

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

  const handleDownload = async (uri: DataUri) => {
    if (uri.startsWith("data:")) {
      const mime = uri.split(";")[0].split(":")[1];
      const base64 = uri.split(",")[1];
      const fileUri = FileSystem.cacheDirectory + "temp_file";
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: mime,
          dialogTitle: "View File",
        });
      } else {
        Alert.alert("Download", "File saved to cache");
      }
    }
  };

  const getDataUriForFile = getItem || (async () => null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>File Cache Diagnostic</Text>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() =>
          sync?.().then(() => Alert.alert("Sync", "Sync completed"))
        }
      >
        <Text style={styles.buttonText}>Sync Cache</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() =>
          reset?.().then(() => Alert.alert("Reset", "Cache reset"))
        }
      >
        <Text style={styles.buttonText}>Reset Cache</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() =>
          refreshNonPending?.().then(() =>
            Alert.alert("Refresh", "Non-pending cleared"),
          )
        }
      >
        <Text style={styles.buttonText}>Refresh Non-Pending</Text>
      </TouchableOpacity>
      <ExpandableSection
        title="Cache Files"
        fileIds={Array.isArray(cacheIds) ? cacheIds : []}
        getDataUri={getDataUriForFile}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onDownload={handleDownload}
        onClearError={clearCacheError}
        expanded={cacheExpanded}
        onToggle={() => setCacheExpanded(!cacheExpanded)}
      />
      <ExpandableSection
        title="Upload Pending"
        fileIds={Array.isArray(pendingIds) ? pendingIds : []}
        getDataUri={getDataUriForFile}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onDownload={handleDownload}
        onClearError={clearUploadError}
        showRetry={true}
        expanded={pendingExpanded}
        onToggle={() => setPendingExpanded(!pendingExpanded)}
      />
      <ExpandableSection
        title="Upload Errors"
        fileIds={Array.isArray(errorIds) ? errorIds : []}
        getDataUri={getDataUriForFile}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onDownload={handleDownload}
        onClearError={clearUploadError}
        showRetry={true}
        expanded={errorExpanded}
        onToggle={() => setErrorExpanded(!errorExpanded)}
      />
      <ExpandableSection
        title="Recent Files"
        fileIds={Array.isArray(recentIds) ? recentIds : []}
        getDataUri={getDataUriForFile}
        onRetryUpload={handleRetryUpload}
        onRetryFetch={handleRetryFetch}
        onDownload={handleDownload}
        onClearError={clearCacheError}
        expanded={recentExpanded}
        onToggle={() => setRecentExpanded(!recentExpanded)}
      />
      <ErrorsSection
        title="Cache Errors"
        errors={cacheErrors}
        onClearError={clearCacheError}
        onRetry={handleRetryError}
        expanded={cacheErrorsExpanded}
        onToggle={() => setCacheErrorsExpanded(!cacheErrorsExpanded)}
      />
      <ErrorsSection
        title="Upload Errors"
        errors={uploadErrors}
        onClearError={clearUploadError}
        onRetry={handleRetryError}
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
  clearButton: {
    backgroundColor: "#fff3e0",
    padding: 8,
    marginVertical: 3,
    borderRadius: 5,
    borderColor: "#ff9800",
    borderWidth: 1,
  },
  retryButton: {
    backgroundColor: "#e3f2fd",
    padding: 8,
    marginVertical: 3,
    borderRadius: 5,
    borderColor: "#2196f3",
    borderWidth: 1,
  },
  errorDetails: {
    padding: 10,
  },
});
