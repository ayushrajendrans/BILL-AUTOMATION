"use client";
import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const BackgroundBeams = ({ className }: { className?: string }) => {
    return (
        <div
            className={cn(
                "absolute inset-0 h-full w-full overflow-hidden bg-neutral-950 pointer-events-none",
                className
            )}
        >
            <div
                style={{
                    "--opacity": "0.3",
                    "--color": "120, 119, 198",
                } as React.CSSProperties}
                className="absolute inset-0 h-full w-full bg-[radial-gradient(circle_800px_at_50%_-20%,rgba(var(--color),var(--opacity)),transparent)]"
            ></div>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.5 }}
                className="absolute left-0 top-0 h-full w-full"
            >
                <div className="absolute left-[-20%] top-[-10%] h-[500px] w-[500px] rounded-full bg-purple-500/20 blur-[120px] mix-blend-screen" />
                <div className="absolute right-[-20%] bottom-[-10%] h-[500px] w-[500px] rounded-full bg-blue-500/20 blur-[120px] mix-blend-screen" />
            </motion.div>
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 grayscale"></div>
        </div>
    );
};
