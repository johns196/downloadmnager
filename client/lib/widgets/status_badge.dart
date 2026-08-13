import "package:flutter/material.dart";

import "../models/download_job.dart";

class StatusBadge extends StatelessWidget {
  final JobState state;
  const StatusBadge({super.key, required this.state});

  Color _color(BuildContext context) {
    switch (state) {
      case JobState.active:
        return Colors.blue;
      case JobState.completed:
        return Colors.green;
      case JobState.error:
        return Colors.red;
      case JobState.paused:
        return Colors.orange;
      case JobState.canceled:
        return Colors.grey;
      case JobState.queued:
        return Colors.purple;
    }
  }

  String _label() {
    switch (state) {
      case JobState.active:
        return "Downloading";
      case JobState.completed:
        return "Completed";
      case JobState.error:
        return "Error";
      case JobState.paused:
        return "Paused";
      case JobState.canceled:
        return "Canceled";
      case JobState.queued:
        return "Queued";
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _label(),
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
