import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { portalsApi } from '../../api'
import type { PortalField, FieldType } from '../../types'
import { PlusIcon, TrashIcon, Bars3Icon, PencilIcon } from '@heroicons/react/24/outline'
import Modal from '../ui/Modal'
import ConfirmModal from '../ui/ConfirmModal'

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Dropdown' },
]

interface SortableFieldRowProps {
  field: PortalField
  onEdit: (f: PortalField) => void
  onDelete: (id: number) => void
}

function SortableFieldRow({ field, onEdit, onDelete }: SortableFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
    >
      <button {...attributes} {...listeners} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing">
        <Bars3Icon className="w-5 h-5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{field.label}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{field.field_type} · key: {field.field_key}{field.is_required ? ' · required' : ''}</div>
      </div>
      <button onClick={() => onEdit(field)} className="text-gray-400 dark:text-gray-500 hover:text-blue-600">
        <PencilIcon className="w-4 h-4" />
      </button>
      <button onClick={() => onDelete(field.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500">
        <TrashIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

interface Props {
  portalId: number
  fields: PortalField[]
}

const defaultForm = () => ({
  label: '',
  field_type: 'text' as FieldType,
  placeholder: '',
  is_required: false,
  options: '',
})

export default function FieldBuilder({ portalId, fields: initialFields }: Props) {
  const qc = useQueryClient()
  const [fields, setFields] = useState<PortalField[]>(initialFields)
  const [showAdd, setShowAdd] = useState(false)
  const [editField, setEditField] = useState<PortalField | null>(null)
  const [deleteFieldId, setDeleteFieldId] = useState<number | null>(null)
  const [form, setForm] = useState(defaultForm())

  const sensors = useSensors(useSensor(PointerSensor))

  const reorderMutation = useMutation({
    mutationFn: (order: number[]) => portalsApi.reorderFields(portalId, order),
    onError: () => toast.error('Reorder failed'),
  })

  const createMutation = useMutation({
    mutationFn: (data: object) => portalsApi.createField(portalId, data),
    onSuccess: (res) => {
      const updated = [...fields, res.data]
      setFields(updated)
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      setShowAdd(false)
      setForm(defaultForm())
      toast.success('Field added')
    },
    onError: () => toast.error('Failed to add field'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) =>
      portalsApi.updateField(portalId, id, data),
    onSuccess: (res) => {
      setFields(fields.map(f => f.id === res.data.id ? res.data : f))
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      setEditField(null)
      toast.success('Field updated')
    },
    onError: () => toast.error('Update failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (fieldId: number) => portalsApi.deleteField(portalId, fieldId),
    onSuccess: (_, fieldId) => {
      setFields(fields.filter(f => f.id !== fieldId))
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      setDeleteFieldId(null)
    },
    onError: () => {
      toast.error('Delete failed')
      setDeleteFieldId(null)
    },
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = fields.findIndex(f => f.id === active.id)
      const newIdx = fields.findIndex(f => f.id === over.id)
      const reordered = arrayMove(fields, oldIdx, newIdx)
      setFields(reordered)
      reorderMutation.mutate(reordered.map(f => f.id))
    }
  }

  const submitForm = (isEdit: boolean) => {
    const payload = {
      label: form.label,
      field_type: form.field_type,
      placeholder: form.placeholder || null,
      is_required: form.is_required,
      options: form.field_type === 'select' ? form.options.split('\n').map(s => s.trim()).filter(Boolean) : null,
    }
    if (isEdit && editField) {
      updateMutation.mutate({ id: editField.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const openEdit = (f: PortalField) => {
    setEditField(f)
    setForm({
      label: f.label,
      field_type: f.field_type,
      placeholder: f.placeholder || '',
      is_required: f.is_required,
      options: (f.options || []).join('\n'),
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Form Fields</h3>
        <button
          onClick={() => { setForm(defaultForm()); setShowAdd(true) }}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          <PlusIcon className="w-4 h-4" /> Add Field
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          No fields yet. Add fields guests will fill in before connecting.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {fields.map(f => (
              <SortableFieldRow
                key={f.id}
                field={f}
                onEdit={openEdit}
                onDelete={(id) => setDeleteFieldId(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add / Edit modal */}
      <Modal
        open={showAdd || editField !== null}
        onClose={() => { setShowAdd(false); setEditField(null) }}
        title={editField ? 'Edit Field' : 'Add Field'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Full Name"
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Field Type</label>
            <select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value as FieldType }))}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500">
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {form.field_type !== 'checkbox' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Placeholder</label>
              <input value={form.placeholder} onChange={e => setForm(f => ({ ...f, placeholder: e.target.value }))}
                placeholder="Optional hint text"
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500" />
            </div>
          )}
          {form.field_type === 'select' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Options (one per line)</label>
              <textarea value={form.options} onChange={e => setForm(f => ({ ...f, options: e.target.value }))}
                rows={4} placeholder={"Option 1\nOption 2\nOption 3"}
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="req" checked={form.is_required} onChange={e => setForm(f => ({ ...f, is_required: e.target.checked }))}
              className="w-4 h-4 accent-blue-600" />
            <label htmlFor="req" className="text-sm text-gray-700 dark:text-gray-300">Required field</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowAdd(false); setEditField(null) }} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
            <button
              onClick={() => submitForm(editField !== null)}
              disabled={!form.label || createMutation.isPending || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {editField ? 'Save' : 'Add Field'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={deleteFieldId !== null}
        onClose={() => setDeleteFieldId(null)}
        onConfirm={() => deleteFieldId !== null && deleteMutation.mutate(deleteFieldId)}
        title="Delete Field"
        message={
          <>Delete the field "{fields.find(f => f.id === deleteFieldId)?.label}"? This cannot be undone.</>
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
