import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon, ActionButton } from '../ui';
import { colors, radius } from '../theme';

const STATUS = {
  new: { label: '新', color: colors.orange, bg: colors.orangeSoft },
  existing: { label: '有', color: colors.green, bg: colors.greenSoft },
  missing: { label: '?', color: colors.red, bg: colors.redSoft }
};

function Badge({ status }) {
  const c = STATUS[status] || STATUS.new;
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

function ItemRowDisplay({ item }) {
  return (
    <View style={s.itemRow}>
      <Badge status={item.status} />
      <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
      {item.description ? <Text style={s.itemDesc} numberOfLines={1}>{item.description}</Text> : null}
    </View>
  );
}

function ItemRowEdit({ item, onChange, onDelete }) {
  return (
    <View style={s.itemRowEdit}>
      <Badge status={item.status} />
      <TextInput style={s.itemInput} value={item.name}
        onChangeText={(name) => onChange({ ...item, name })}
        placeholder="物品名称" placeholderTextColor={colors.textDim} />
      <Pressable onPress={onDelete} hitSlop={8} style={s.deleteBtn}>
        <AppIcon name="x" size={14} color={colors.red} />
      </Pressable>
    </View>
  );
}

export default function SuggestionCard({ suggestion, onConfirm, onEdit, loading }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  if (!suggestion) return null;

  const data = editing && draft ? draft : suggestion;
  const { space, position, items = [], uncertain_items = [] } = data;
  const total = items.length;

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(suggestion)));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
  }

  function updateDraft(fn) {
    setDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; });
  }

  function updateItem(i, newItem) {
    updateDraft((d) => { d.items[i] = newItem; });
  }

  function deleteItemAt(i) {
    updateDraft((d) => { d.items.splice(i, 1); });
  }

  function addItem() {
    updateDraft((d) => {
      d.items.push({ name: '', description: '', status: 'new' });
    });
  }

  function confirmEdit() {
    if (draft) onConfirm?.(draft);
  }

  return (
    <View style={s.card}>
      <View style={s.header}>
        {editing ? (
          <View style={s.headerEdit}>
            <TextInput style={s.locationInput} value={space?.name}
              onChangeText={(v) => updateDraft((d) => { d.space.name = v; })}
              placeholder="空间" placeholderTextColor={colors.textDim} />
            <Text style={s.locationSlash}>/</Text>
            <TextInput style={s.locationInput} value={position?.name}
              onChangeText={(v) => updateDraft((d) => { d.position.name = v; })}
              placeholder="位置" placeholderTextColor={colors.textDim} />
          </View>
        ) : (
          <>
            <Text style={s.location} numberOfLines={1}>{space?.name} / {position?.name}</Text>
            {(space?.is_new || position?.is_new) ? <Text style={s.newLabel}>新位置</Text> : null}
          </>
        )}
      </View>

      {(items.length > 0 || editing) ? (
        <View style={s.group}>
          {items.map((item, i) => editing ? (
            <ItemRowEdit key={i} item={item}
              onChange={(v) => updateItem(i, v)}
              onDelete={() => deleteItemAt(i)} />
          ) : (
            <ItemRowDisplay key={i} item={item} />
          ))}
          {editing ? (
            <Pressable style={s.addBtn} onPress={addItem}>
              <AppIcon name="plus" size={14} color={colors.textSecondary} />
              <Text style={s.addBtnText}>添加物品</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!editing && uncertain_items.length > 0 ? (
        <View style={s.uncertain}>
          {uncertain_items.map((item, i) => (
            <Text key={i} style={s.uncertainText}>? {item.description}</Text>
          ))}
        </View>
      ) : null}

      <View style={s.footer}>
        <Text style={s.footerCount}>{total} 件</Text>
        <View style={s.footerActions}>
          {editing ? (
            <>
              <ActionButton label="取消" icon="x" variant="secondary" compact onPress={cancelEdit} />
              <ActionButton label="保存" icon="check" compact onPress={confirmEdit} loading={loading} />
            </>
          ) : (
            <>
              <ActionButton label="修改" icon="edit-2" variant="secondary" compact onPress={startEdit} />
              <ActionButton label="确认" icon="check" compact onPress={() => onConfirm?.(suggestion)} loading={loading} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden'
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  headerEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  location: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700'
  },
  locationInput: {
    flex: 1,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
    paddingHorizontal: 10,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600'
  },
  locationSlash: {
    color: colors.textDim,
    fontSize: 16
  },
  newLabel: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '700'
  },
  group: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 4
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4
  },
  itemRowEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  itemName: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600'
  },
  itemDesc: {
    color: colors.textDim,
    fontSize: 12,
    maxWidth: 100
  },
  itemInput: {
    flex: 1,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
    paddingHorizontal: 10,
    color: colors.text,
    fontSize: 14
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.redSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    marginTop: 4
  },
  addBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  uncertain: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput
  },
  uncertainText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line
  },
  footerCount: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600'
  },
  footerActions: {
    flexDirection: 'row',
    gap: 8
  }
});
