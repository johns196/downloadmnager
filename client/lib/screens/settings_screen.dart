import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../models/settings.dart";
import "../services/connection_prefs.dart";
import "../state/settings_store.dart";

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late int _maxConcurrentJobs;
  late int _maxChunksPerJob;
  late bool _unlimitedBandwidth;
  late double _bandwidthCapMbps;
  bool _initialized = false;
  bool _saving = false;

  final _hostController = TextEditingController();
  bool _hostSaving = false;

  @override
  void initState() {
    super.initState();
    ConnectionPrefs.getHost().then((host) {
      if (mounted) setState(() => _hostController.text = host);
    });
  }

  @override
  void dispose() {
    _hostController.dispose();
    super.dispose();
  }

  Future<void> _saveHost() async {
    setState(() => _hostSaving = true);
    await ConnectionPrefs.setHost(_hostController.text);
    if (mounted) {
      setState(() => _hostSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Saved. Restart the app for this to take effect.")),
      );
    }
  }

  void _initFrom(GlobalSettings settings) {
    if (_initialized) return;
    _maxConcurrentJobs = settings.maxConcurrentJobs;
    _maxChunksPerJob = settings.maxChunksPerJob;
    _unlimitedBandwidth = settings.globalBandwidthCap == null;
    _bandwidthCapMbps = settings.globalBandwidthCap != null ? settings.globalBandwidthCap! / 125000 : 10;
    _initialized = true;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final next = GlobalSettings(
      maxConcurrentJobs: _maxConcurrentJobs,
      maxChunksPerJob: _maxChunksPerJob,
      globalBandwidthCap: _unlimitedBandwidth ? null : (_bandwidthCapMbps * 125000).round(),
    );
    try {
      await context.read<SettingsStore>().update(next);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Settings saved")));
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Error: $err")));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<SettingsStore>();
    _initFrom(store.settings);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text("Connection", style: Theme.of(context).textTheme.titleSmall),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: TextField(
            controller: _hostController,
            decoration: const InputDecoration(
              labelText: "Backend host",
              hintText: ConnectionPrefs.defaultHost,
              helperText: "host:port -- e.g. 127.0.0.1:8787 for this device, "
                  "or a deployed backend's address once you have one running.",
              helperMaxLines: 2,
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            onPressed: _hostSaving ? null : _saveHost,
            child: _hostSaving
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text("Save connection"),
          ),
        ),
        const Divider(height: 32),
        Text("Concurrency", style: Theme.of(context).textTheme.titleSmall),
        ListTile(
          title: const Text("Max concurrent downloads"),
          subtitle: Slider(
            value: _maxConcurrentJobs.toDouble(),
            min: 1,
            max: 10,
            divisions: 9,
            label: "$_maxConcurrentJobs",
            onChanged: (v) => setState(() => _maxConcurrentJobs = v.round()),
          ),
          trailing: Text("$_maxConcurrentJobs"),
        ),
        ListTile(
          title: const Text("Max parallel chunks per download"),
          subtitle: Slider(
            value: _maxChunksPerJob.toDouble(),
            min: 1,
            max: 16,
            divisions: 15,
            label: "$_maxChunksPerJob",
            onChanged: (v) => setState(() => _maxChunksPerJob = v.round()),
          ),
          trailing: Text("$_maxChunksPerJob"),
        ),
        const Divider(height: 32),
        Text("Bandwidth", style: Theme.of(context).textTheme.titleSmall),
        SwitchListTile(
          title: const Text("Unlimited bandwidth"),
          value: _unlimitedBandwidth,
          onChanged: (v) => setState(() => _unlimitedBandwidth = v),
        ),
        if (!_unlimitedBandwidth)
          ListTile(
            title: const Text("Global bandwidth cap"),
            subtitle: Slider(
              value: _bandwidthCapMbps,
              min: 0.5,
              max: 200,
              label: "${_bandwidthCapMbps.toStringAsFixed(1)} Mbps",
              onChanged: (v) => setState(() => _bandwidthCapMbps = v),
            ),
            trailing: Text("${_bandwidthCapMbps.toStringAsFixed(1)} Mbps"),
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text("Save settings"),
        ),
      ],
    );
  }
}
