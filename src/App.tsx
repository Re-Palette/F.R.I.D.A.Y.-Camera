import { useEffect, useState } from 'react';
import { Hud } from './hud/Hud';
import { OrchestratorContext } from './hud/hooks';
import { Orchestrator } from './orchestrator/Orchestrator';

export default function App() {
  const [orch] = useState(() => new Orchestrator());
  useEffect(() => {
    void orch.boot();
    const w = window as unknown as { friday?: Orchestrator };
    w.friday = orch; // handy for debugging / automation
    return () => orch.dispose();
  }, [orch]);
  return (
    <OrchestratorContext.Provider value={orch}>
      <Hud />
    </OrchestratorContext.Provider>
  );
}
