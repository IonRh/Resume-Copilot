"use client"

import { useEffect } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { TextStyle } from "@tiptap/extension-text-style"
import { Color } from "@tiptap/extension-color"
import { FontFamily } from "@tiptap/extension-font-family"
import TextAlign from "@tiptap/extension-text-align"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import type { JSONContent } from "@/types/resume"
import { emptyCoverLetterDoc } from "@/lib/cover-letter-document"
import RichTextToolbar from "@/components/rich-text-toolbar"

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const fontSize = typeof attributes.fontSize === "string" ? attributes.fontSize : null
              if (!fontSize) return {}
              return { style: `font-size: ${fontSize}` }
            },
          },
        },
      },
    ]
  },
})

const PlainTextPaste = Extension.create({
  name: "plainTextPaste",
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handlePaste(_: EditorView, event: ClipboardEvent) {
            const cd = event.clipboardData
            if (!cd) return false
            const html = cd.getData("text/html") || ""
            const text = cd.getData("text/plain") || ""
            if (html && /<(p|br|div|ul|ol|li|h[1-6])\b/i.test(html)) return false
            if (!text || !/\r?\n/.test(text)) return false
            event.preventDefault()
            const lines = text.replace(/\r\n?/g, "\n").split("\n")
            const content = lines.map((line) =>
              line
                ? { type: "paragraph", content: [{ type: "text", text: line }] }
                : { type: "paragraph" },
            )
            editor.chain().focus().insertContent(content).run()
            return true
          },
        },
      }),
    ]
  },
})

interface CoverLetterEditorProps {
  title: string
  onTitleChange: (title: string) => void
  content?: JSONContent | null
  onChange: (content: JSONContent) => void
  placeholder?: string
}

export default function CoverLetterEditor({
  title,
  onTitleChange,
  content,
  onChange,
  placeholder = "在右侧填写目标岗位或 JD 信息后，生成的自荐信将显示于此",
}: CoverLetterEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: {},
        codeBlock: false,
        horizontalRule: false,
        trailingNode: false,
        dropcursor: false,
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      PlainTextPaste,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline underline-offset-2" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: content || emptyCoverLetterDoc(),
    editorProps: {
      attributes: {
        class: "cover-letter-prose rt-editor min-h-[560px] focus:outline-none",
        "data-placeholder": placeholder,
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON())
    },
  })

  useEffect(() => {
    if (!editor) return
    const next = content || emptyCoverLetterDoc()
    const current = editor.getJSON()
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.commands.setContent(next)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className="cover-letter-sheet">
      <div className="cover-letter-format-bar">
        <RichTextToolbar editor={editor} layout="inline" />
      </div>

      <div className="cover-letter-paper">
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="请输入标题"
          className="cover-letter-title"
        />
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
