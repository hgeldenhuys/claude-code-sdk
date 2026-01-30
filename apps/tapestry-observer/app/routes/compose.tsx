/**
 * Compose Route - Send Message Form
 *
 * Compose and send messages with mode selector (Chat, Mail, Memo, Channel).
 * Messages are sent through the BFF proxy — no API keys in the browser.
 */

import { useCallback } from "react";
import { ComposeForm } from "~/components/ComposeForm";
import { sendMessage } from "~/lib/api-client";
import { useSignalDB } from "~/lib/signaldb";

export default function Compose() {
  const { agents, channels } = useSignalDB();

  const handleSend = useCallback(
    async (payload: {
      senderId: string;
      targetType: string;
      targetAddress: string;
      messageType: string;
      content: string;
      channelId?: string;
      metadata?: Record<string, unknown>;
      threadId?: string;
    }) => {
      await sendMessage(payload);
    },
    []
  );

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-gray-200 mb-4">
        Send Message
      </h1>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <ComposeForm
          agents={agents}
          channels={channels}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
