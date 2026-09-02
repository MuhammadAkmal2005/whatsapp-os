import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { AUTOMATION_PRESETS } from '@/components/automation/presets';
import { isTriggerWatched } from '@/components/automation/watched-triggers';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { actionTypeLabel, triggerTypeLabel } from '@/lib/labels';

/**
 * The four ready-made automations, offered to a workspace that has none yet.
 *
 * Each row states the whole rule in one line — when it starts, then every step in order —
 * because that sentence is the only thing a shop owner needs in order to decide, and it is
 * derived from the same data the builder opens with. The cards used to carry a hand-written
 * summary and a hand-typed step count beside a decorative glyph; both went stale, and the
 * glyph said nothing the name did not.
 *
 * A list rather than a grid of four cards: these are four alternatives to read down, not four
 * things to compare across.
 */
export function TemplatePicker() {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Or start from a ready-made rule</CardTitle>
        <CardDescription>
          Each one opens in the builder with its trigger and steps already filled in, so you can
          change the wording before you save. Nothing runs until you do.
        </CardDescription>
      </CardHeader>

      <ul className="border-t border-border">
        {AUTOMATION_PRESETS.map((preset) => (
          <li key={preset.id} className="border-b border-border last:border-b-0">
            <Link
              href={`/automations/new?template=${preset.id}`}
              className="group flex items-center gap-4 px-5 py-3.5 transition-colors duration-instant ease-out hover:bg-surface-sunken"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{preset.headline}</span>

                {/*
                  The rule as a sentence. Read out of the preset itself, so a step added to a
                  preset shows up here without anyone remembering to update a description.
                */}
                <span className="text-sm text-muted-foreground">
                  When {triggerTypeLabel(preset.values.triggerType)}
                  {preset.values.actions.map((action) => (
                    <span key={action.id}>
                      <span aria-hidden> → </span>
                      <span className="sr-only">, then </span>
                      {actionTypeLabel(action.type).toLowerCase()}
                    </span>
                  ))}
                </span>

                {/*
                  Two of these presets start from an event nothing raises yet. Said here rather
                  than only in the builder, so nobody picks one expecting it to work — and stated
                  in weight rather than colour, because this sits on a plain card at small size.
                */}
                {isTriggerWatched(preset.values.triggerType) ? null : (
                  <span className="text-sm font-medium text-foreground">
                    Will not run yet — nothing in the product raises this event.
                  </span>
                )}
              </span>

              <ChevronRight
                className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-fast ease-out group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
