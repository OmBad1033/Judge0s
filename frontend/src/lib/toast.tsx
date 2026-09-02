import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Flex, Text, VStack } from '@chakra-ui/react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const KIND_CONFIG: Record<ToastKind, { color: string; icon: ReactNode }> = {
  info: { color: 'blue.solid', icon: <Info size={18} /> },
  success: { color: 'green.solid', icon: <CheckCircle2 size={18} /> },
  error: { color: 'red.solid', icon: <AlertCircle size={18} /> },
  warning: { color: 'orange.solid', icon: <TriangleAlert size={18} /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    counter.current += 1;
    const id = `t_${counter.current}_${Date.now()}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Box
        position="fixed"
        bottom="4"
        right="4"
        zIndex="60"
        w="full"
        maxW="sm"
        pointerEvents="none"
        role="region"
        aria-live="polite"
      >
        <VStack gap="2" align="stretch">
          {toasts.map((t) => {
            const cfg = KIND_CONFIG[t.kind];
            return (
              <Flex
                key={t.id}
                align="flex-start"
                gap="2"
                borderWidth="1px"
                borderColor="border.subtle"
                borderLeftWidth="4px"
                borderLeftColor={cfg.color}
                borderRadius="lg"
                bg="bg.surface"
                px="3"
                py="2.5"
                boxShadow="md"
                pointerEvents="auto"
              >
                <Box color={cfg.color} mt="0.5" flexShrink="0">
                  {cfg.icon}
                </Box>
                <Text fontSize="sm" fontWeight="medium">
                  {t.message}
                </Text>
              </Flex>
            );
          })}
        </VStack>
      </Box>
    </ToastContext.Provider>
  );
}
