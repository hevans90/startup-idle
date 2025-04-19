import { useEffect } from "react";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";

function App() {
  const { money, increaseMoney } = useMoneyStore();

  useEffect(() => {
    setInterval(() => {
      useGeneratorStore.getState().tickGenerators();
    }, 200); // check every 200ms for ticks
  }, []);

  return (
    <div className="w-full flex flex-col items-center mt-12 gap-8">
      <section className="prose">
        <h1>Startup Idle</h1>
      </section>
      <div>
        <button onClick={() => increaseMoney(1)}>${money.toString()}</button>
      </div>
    </div>
  );
}

export default App;
