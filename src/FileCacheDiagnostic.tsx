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
  useCacheFileIds,
  useErrorFileIds,
  useFileCache,
  usePendingFileIds,
  useRecentFileIds,
} from "./provider";
import { DataUri, FileId } from "./types";

interface FileDetailsProps {
  fileId: FileId;
  dataUri: DataUri | null;
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onDownload: (uri: DataUri) => Promise<void>;
}

const FileDetailsInline: React.FC<FileDetailsProps> = ({
  fileId,
  dataUri,
  onRetryUpload,
  onRetryFetch,
  onDownload,
}) => (
  <View style={styles.fileDetails}>
    <Text style={styles.detailsTitle}>File Details: {fileId}</Text>
    <Text>File ID: {fileId}</Text>
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
  onRetryUpload: (id: FileId, uri?: DataUri) => Promise<void>;
  onRetryFetch: (id: FileId) => Promise<void>;
  onDownload: (uri: DataUri) => Promise<void>;
  showRetry?: boolean;
}

const FileItem: React.FC<FileItemProps> = ({
  fileId,
  getDataUri,
  onRetryUpload,
  onRetryFetch,
  onDownload,
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
            onRetryUpload={onRetryUpload}
            onRetryFetch={onRetryFetch}
            onDownload={onDownload}
          />
        )
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

export const FileCacheDiagnostic: React.FC = () => {
  const [cacheExpanded, setCacheExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const { sync, reset, refreshNonPending, getItem } = useFileCache();
  const cacheIds = useCacheFileIds();
  const pendingIds = usePendingFileIds();
  const errorIds = useErrorFileIds();
  const recentIds = useRecentFileIds();

  const handleRetryUpload = async (id: FileId, uri?: DataUri) => {
    console.log("Retry upload for", id, uri);
  };

  const handleRetryFetch = async (id: FileId) => {
    console.log("Retry fetch for", id);
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
        expanded={recentExpanded}
        onToggle={() => setRecentExpanded(!recentExpanded)}
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
  button: {
    backgroundColor: "#ddd",
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
    borderColor: "#454545ff",
    borderWidth: 1,
  },
});
