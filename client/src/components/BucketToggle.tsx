import { useStore, type VenueBucket } from "@/lib/store";
import { motion } from "framer-motion";

export function BucketToggle() {
  const activeBucket = useStore(s => s.activeBucket);
  const setActiveBucket = useStore(s => s.setActiveBucket);
  const mode = useStore(s => s.mode);

  if (mode !== "idle") return null;

  const options: { value: VenueBucket; label: string }[] = [
    { value: "restaurant", label: "Restaurants" },
    { value: "bar", label: "Bars" },
  ];

  return (
    <div
      className="inline-flex rounded-full bg-gray-100 p-0.5 relative"
      data-testid="bucket-toggle"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            if (opt.value !== activeBucket) {
              setActiveBucket(opt.value);
            }
          }}
          className={`relative z-10 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
            activeBucket === opt.value
              ? "text-white"
              : "text-gray-500 hover:text-gray-700"
          }`}
          data-testid={`bucket-toggle-${opt.value}`}
        >
          {activeBucket === opt.value && (
            <motion.div
              className="absolute inset-0 bg-black rounded-full"
              initial={false}
              animate={{ opacity: 1 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span className="relative z-10">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
