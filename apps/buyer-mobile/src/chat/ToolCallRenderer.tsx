import { Fragment } from 'react'
import { TrustBalanceStripCard } from './cards/TrustBalanceStripCard'
import { RecommendedListingsCard } from './cards/RecommendedListingsCard'
import { LiveLobbyCard } from './cards/LiveLobbyCard'
import { ActiveBidsCard } from './cards/ActiveBidsCard'
import { BidRecommendationCard } from './cards/BidRecommendationCard'
import { DealPipelineCard } from './cards/DealPipelineCard'
import { UnknownToolCard } from './cards/UnknownToolCard'
import { extractPayload } from './toolPayloads'
import { isBuyerToolName, type ToolCall } from './types'

export interface ToolCallRendererProps {
  readonly toolCalls: readonly ToolCall[]
  readonly translate: (key: string) => string
}

// Single dispatch surface — each tool name maps to one card. New tools are
// added by extending `BUYER_TOOL_NAMES` and adding a `case` here.

export function ToolCallRenderer({ toolCalls, translate }: ToolCallRendererProps) {
  if (toolCalls.length === 0) {
    return null
  }
  return (
    <Fragment>
      {toolCalls.map((toolCall, index) => {
        const key = `${toolCall.name}-${index}`
        const payload = extractPayload(toolCall)
        if (!isBuyerToolName(toolCall.name)) {
          return <UnknownToolCard key={key} toolName={toolCall.name} payload={payload} />
        }
        switch (toolCall.name) {
          case 'marketplace.recommended':
            return <RecommendedListingsCard key={key} payload={payload} translate={translate} />
          case 'marketplace.lobby':
            return <LiveLobbyCard key={key} payload={payload} translate={translate} />
          case 'bids.active':
            return <ActiveBidsCard key={key} payload={payload} translate={translate} />
          case 'kyc.status':
            return <TrustBalanceStripCard key={key} payload={payload} translate={translate} />
          case 'bids.recommend':
            return <BidRecommendationCard key={key} payload={payload} translate={translate} />
          case 'deals.pipeline':
            return <DealPipelineCard key={key} payload={payload} translate={translate} />
          default:
            return <UnknownToolCard key={key} toolName={toolCall.name} payload={payload} />
        }
      })}
    </Fragment>
  )
}
