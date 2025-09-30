import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface ExpandableProps {
  title: string;
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}

export const Expandable: React.FC<ExpandableProps> = ({
  title,
  children,
  expanded,
  onToggle,
}) => {
  const chevron = expanded ? "▼" : "▶";
  return (
    <View style={styles.expandable}>
      <TouchableOpacity style={styles.expandableHeader} onPress={onToggle}>
        <Text style={styles.expandableTitle}>{title}</Text>
        <Text style={styles.chevron}>{chevron}</Text>
      </TouchableOpacity>
      {expanded && <View style={styles.expandableContent}>{children}</View>}
    </View>
  );
};

const styles = StyleSheet.create({
  expandable: {
    marginVertical: 5,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 5,
  },
  expandableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f5f5f5",
  },
  expandableTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },
  chevron: {
    fontSize: 16,
  },
  expandableContent: {
    padding: 10,
  },
});
