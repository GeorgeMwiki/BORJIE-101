export type ChatRole = 'user' | 'assistant'

export interface EvidenceChip {
  id: string
  label: string
  url?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  evidence: ReadonlyArray<EvidenceChip>
  createdAt: number
  streaming: boolean
}

export interface ChatStreamEvent {
  type: 'delta' | 'evidence' | 'done' | 'error'
  delta?: string
  evidence?: ReadonlyArray<EvidenceChip>
  error?: string
}
