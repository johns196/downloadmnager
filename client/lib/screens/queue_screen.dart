import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../models/download_job.dart";
import "../state/download_store.dart";
import "../widgets/add_link_dialog.dart";
import "../widgets/download_card.dart";

class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadStore>();
    final sections = <(String, List<DownloadJob>)>[
      ("Active", store.active),
      ("Queued / Paused", store.queuedOrPaused),
      ("Failed", store.failed),
    ].where((s) => s.$2.isNotEmpty).toList();

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: store.refresh,
        child: !store.backendOnline
            ? _offlineNotice(context, store)
            : sections.isEmpty
                ? const _EmptyState()
                : ListView(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    children: [
                      for (final section in sections) ...[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                          child: Text(section.$1, style: Theme.of(context).textTheme.titleSmall),
                        ),
                        for (final job in section.$2) DownloadCard(job: job),
                      ],
                    ],
                  ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showDialog(context: context, builder: (_) => const AddLinkDialog()),
        icon: const Icon(Icons.add),
        label: const Text("Add link"),
      ),
    );
  }

  Widget _offlineNotice(BuildContext context, DownloadStore store) {
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            children: [
              Icon(Icons.cloud_off, size: 48, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 12),
              const Text("Can't reach the Download Manager backend", textAlign: TextAlign.center),
              const SizedBox(height: 4),
              Text(
                store.lastError ?? "",
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              FilledButton(onPressed: store.refresh, child: const Text("Retry")),
            ],
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.all(48),
          child: Column(
            children: [
              Icon(Icons.download_rounded, size: 48, color: Theme.of(context).colorScheme.outline),
              const SizedBox(height: 12),
              const Text("No downloads yet"),
              const SizedBox(height: 4),
              Text(
                "Add a link or sniff a page from the Sniffer tab.",
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    );
  }
}
