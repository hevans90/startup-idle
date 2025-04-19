import { useEffect } from "react";
import { GeneratorBuyButton } from "./molecules/generator-buy-button";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";

function App() {
  const { money, increaseMoney } = useMoneyStore();

  const { generators } = useGeneratorStore();

  useEffect(() => {
    setInterval(() => {
      useGeneratorStore.getState().tickGenerators();
    }, 200); // check every 200ms for ticks
  }, []);

  return (
    <div className="w-full flex flex-col items-center pt-16 gap-8">
      <section className="prose">
        <h1>Startup Idle</h1>
      </section>
      <section>
        <button
          className="text-3xl cursor-pointer hover:bg-primary-200"
          onClick={() => increaseMoney(1)}
        >
          ${money.toFixed(2)}
        </button>
      </section>
      <div>
        <div>
          {generators.map((gen) => (
            <div
              key={gen.id}
              className="flex flex-col gap-2 items-center border-[1px] border-primary-500 p-2"
            >
              {gen.name} - {gen.amount}
              <GeneratorBuyButton id={gen.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
