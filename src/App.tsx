import { useEffect, useState } from 'react';
import { Hud } from './hud/Hud';
import { OrchestratorContext } from './hud/hooks';
import { Orchestrator } from './orchestrator/Orchestrator';
import { getState } from './store/useFriday';

export default function App() {
  const [orch] = useState(() => new Orchestrator());
  useEffect(() => {
    void orch.boot();
    const w = window as unknown as { friday?: Orchestrator; fridayState?: typeof getState };
    w.friday = orch; // handy for debugging / automation
    w.fridayState = getState;
    return () => orch.dispose();
  }, [orch]);
  return (
    <OrchestratorContext.Provider value={orch}>
      <Hud />
    </OrchestratorContext.Provider>
  );
}
