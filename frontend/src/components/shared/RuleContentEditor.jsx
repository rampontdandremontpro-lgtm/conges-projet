import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  INTERNAL_RULE_VARIABLES,
  contentFromSegments,
  resolveVariables,
  segmentsFromContent,
} from '@/utils/practicalInfoRules'

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function variableLabel(key) {
  return INTERNAL_RULE_VARIABLES.find((variable) => variable.name === key)?.label ?? key
}

function chipTitle(key) {
  return `${variableLabel(key)} — cette valeur est mise à jour automatiquement depuis les paramètres de congés.`
}

function readSegmentsFromNode(node, segments = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Les espaces invisibles (ancrage de curseur) ne doivent pas être persistés.
      segments.push({ type: 'text', value: (child.nodeValue ?? '').replace(/\u200b/g, '') })
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const key = child.getAttribute?.('data-key')
    if (key) {
      segments.push({ type: 'variable', key })
      continue
    }

    if (child.tagName === 'BR') {
      segments.push({ type: 'text', value: '\n' })
    } else if (child.tagName === 'DIV' || child.tagName === 'P') {
      readSegmentsFromNode(child, segments)
      segments.push({ type: 'text', value: '\n' })
    } else {
      readSegmentsFromNode(child, segments)
    }
  }
  return segments
}

export function RuleContentEditor({ value, settings, onChange }) {
  const editorRef = useRef(null)
  const values = resolveVariables(settings)
  const trackedKeysRef = useRef([])
  const lastSafeContentRef = useRef('')
  const [removedKeys, setRemovedKeys] = useState([])

  const renderContent = (content) => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = segmentsFromContent(content)
      .map((segment) => {
        if (segment.type === 'variable') {
          const displayValue = values[segment.key] ?? segment.key
          return `<span contenteditable="false" data-key="${escapeHtml(segment.key)}" class="rule-chip" title="${escapeHtml(chipTitle(segment.key))}">${escapeHtml(displayValue)}</span>`
        }
        return escapeHtml(segment.value)
      })
      .join('')
  }

  useEffect(() => {
    const content = value ?? ''
    renderContent(content)
    trackedKeysRef.current = segmentsFromContent(content)
      .filter((segment) => segment.type === 'variable')
      .map((segment) => segment.key)
    lastSafeContentRef.current = content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readContent = () => {
    const editor = editorRef.current
    if (!editor) return

    const segments = readSegmentsFromNode(editor)
    const nextContent = contentFromSegments(segments)
    const nextKeys = segments
      .filter((segment) => segment.type === 'variable')
      .map((segment) => segment.key)
    const removed = trackedKeysRef.current.filter((key) => !nextKeys.includes(key))

    if (removed.length > 0) {
      // Une valeur automatique vient d'être supprimée : on ne met pas à jour
      // l'état sûr, afin de pouvoir la rétablir.
      setRemovedKeys(removed)
    } else {
      lastSafeContentRef.current = nextContent
      trackedKeysRef.current = nextKeys
      setRemovedKeys([])
    }

    onChange(nextContent)
  }

  const restore = () => {
    const content = lastSafeContentRef.current
    renderContent(content)
    trackedKeysRef.current = segmentsFromContent(content)
      .filter((segment) => segment.type === 'variable')
      .map((segment) => segment.key)
    setRemovedKeys([])
    onChange(content)
  }

  const removedLabels = removedKeys.map((key) => variableLabel(key))

  return (
    <div className="rule-content-editor">
      <div
        ref={editorRef}
        className="rule-content-editor__field"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Contenu explicatif"
        data-placeholder="Saisissez le texte explicatif de la règle…"
        onInput={readContent}
        onBlur={readContent}
      />

      <p className="rule-content-editor__hint">
        Les valeurs en bleu sont mises à jour automatiquement depuis les paramètres de congés.
      </p>

      {removedKeys.length > 0 && (
        <div className="rule-content-editor__warning" role="status">
          <Icon name="alert" size={15} />
          <span>
            Valeur automatique supprimée{removedLabels.length > 0 ? ` (${removedLabels.join(', ')})` : ''}.
            Elle ne sera plus mise à jour automatiquement.
          </span>
          <button type="button" onClick={restore}>
            Rétablir
          </button>
        </div>
      )}
    </div>
  )
}
