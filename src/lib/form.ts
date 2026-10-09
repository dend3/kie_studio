import type { FieldSchema, KlingElement } from './models/types.ts'

function fieldId(name: string): string {
  return `field-${name}`
}

export function buildDefaultValues(
  fields: FieldSchema[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) {
      values[field.name] = field.default
      continue
    }
    switch (field.type) {
      case 'boolean':
        values[field.name] = false
        break
      case 'reference':
      case 'kling_elements':
        values[field.name] = []
        break
      case 'number':
        values[field.name] = field.min ?? 0
        break
      case 'enum':
        values[field.name] = field.enum?.[0] ?? ''
        break
      case 'string':
      case 'textarea':
      case 'json':
        values[field.name] = ''
        break
      default: {
        const exhaustive: never = field.type
        throw new Error(`Unsupported field type: ${exhaustive}`)
      }
    }
  }
  return values
}

function isKlingElementComplete(element: unknown): boolean {
  if (!element || typeof element !== 'object') return false
  const item = element as KlingElement
  return (
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    Array.isArray(item.element_input_urls) &&
    item.element_input_urls.length >= 1
  )
}

export function isFormDirty(
  fields: FieldSchema[],
  values: Record<string, unknown>,
): boolean {
  const defaults = buildDefaultValues(fields)
  for (const field of fields) {
    const value = values[field.name]

    const defaultValue = defaults[field.name]
    if (field.type === 'reference' || field.type === 'kling_elements') {
      const items = Array.isArray(value) ? value : []
      const defaultItems = Array.isArray(defaultValue) ? defaultValue : []
      if (items.length !== defaultItems.length) return true
      if (JSON.stringify(items) !== JSON.stringify(defaultItems)) return true
      continue
    }
    if (value !== defaultValue) return true
  }
  return false
}

export function focusFirstFieldError(errors: Record<string, string>): void {
  const first = Object.keys(errors)[0]
  if (!first) return
  const id = fieldId(first)
  window.requestAnimationFrame(() => {
    const element = document.getElementById(id)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.focus({ preventScroll: true })
  })
}

export function validateFields(
  fields: FieldSchema[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.name]

    if (typeof value === 'string' && field.maxLength && value.length > field.maxLength) {
      errors[field.name] = `${field.label} must be within ${field.maxLength} characters`
      continue
    }
    if (field.type === 'number' && typeof value === 'number') {
      if (field.min !== undefined && value < field.min) {
        errors[field.name] = `${field.label} must be ≥ ${field.min}`
        continue
      }
      if (field.max !== undefined && value > field.max) {
        errors[field.name] = `${field.label} must be ≤ ${field.max}`
        continue
      }
    }
    if (field.type === 'reference' && Array.isArray(value) && field.maxItems && value.length > field.maxItems) {
      errors[field.name] = `${field.label} allows up to ${field.maxItems} items`
      continue
    }
    if (
      field.conflictsWith?.some((name) => {
        const other = values[name]
        return Boolean(value) && Boolean(other) && (!Array.isArray(other) || other.length > 0)
      })
    ) {
      errors[field.name] = `${field.label} conflicts with another input`
      continue
    }

    if (field.type === 'json') {
      if (value === undefined || value === null || value === '') {
        if (field.required) errors[field.name] = `${field.label} is required`
        continue
      }
      if (typeof value === 'string' || typeof value !== 'object') {
        errors[field.name] = `${field.label} is not valid JSON`
      }
      continue
    }

    if (
      field.type === 'kling_elements' &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.some((element) => !isKlingElementComplete(element))
    ) {
      errors[field.name] =
        `${field.label}: each element needs a name and 1+ images`
      continue
    }

    if (!field.required) continue
    if (value === undefined || value === null || value === '') {
      errors[field.name] = `${field.label} is required`
      continue
    }
    if (
      (field.type === 'reference' || field.type === 'kling_elements') &&
      Array.isArray(value) &&
      value.length === 0
    ) {
      errors[field.name] = `${field.label} is required`
    }
  }
  return errors
}
