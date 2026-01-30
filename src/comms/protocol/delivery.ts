/**
 * Delivery Mode Resolution
 *
 * Derives the delivery mode for a message from its type and metadata.
 * Centralizes the logic so the daemon and other consumers don't need
 * to duplicate the derivation rules.
 */

import type { DeliveryMode, Message } from './types';

/**
 * Resolve the delivery mode for a message.
 *
 * Resolution order:
 * 1. Explicit `deliveryMode` in metadata_json
 * 2. Derived from message_type
 *
 * Default derivation:
 * | message_type | delivery  |
 * |-------------|-----------|
 * | chat        | push      |
 * | command     | push      |
 * | memo        | broadcast |
 * | response    | matches original (from metadata) or push |
 */
export function resolveDeliveryMode(message: Message): DeliveryMode {
  // 1. Explicit override in metadata
  const meta = message.metadata;
  if (meta?.deliveryMode) {
    return meta.deliveryMode as DeliveryMode;
  }

  // 2. Derive from message_type
  switch (message.messageType) {
    case 'chat':
      return 'push';
    case 'command':
      return 'push';
    case 'memo':
      return 'broadcast';
    case 'response':
      return (meta?.originalDelivery as DeliveryMode) ?? 'push';
    default:
      return 'push';
  }
}
