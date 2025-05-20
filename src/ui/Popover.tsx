import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useHover,
  useId,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from "@floating-ui/react";
import * as React from "react";

interface PopoverOptions {
  initialOpen?: boolean;
  placement?: Placement;
  floatOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openOnHover?: boolean;
  persistOnHoverContent?: boolean;
}

function usePopover({
  initialOpen = false,
  placement = "left",
  floatOffset = 5,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  openOnHover = false,
  persistOnHoverContent = false, // stay open while hovering content
}: PopoverOptions = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(initialOpen);
  const [labelId, setLabelId] = React.useState<string | undefined>();
  const [descriptionId, setDescriptionId] = React.useState<
    string | undefined
  >();

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = setControlledOpen ?? setUncontrolledOpen;

  const floatingParentIdFromTree = useFloatingParentNodeId();

  const inheritedParentId = React.useContext(FloatingNodeContext);
  const parentId = inheritedParentId ?? floatingParentIdFromTree;

  const nodeId = useFloatingNodeId(parentId ?? undefined);

  const tree = useFloatingTree();

  console.log({ tree });

  const data = useFloating({
    nodeId,
    placement,
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(floatOffset),
      flip({
        crossAxis: placement.includes("-"),
        fallbackAxisSideDirection: "end",
        padding: 5,
      }),
      shift({ padding: 5 }),
    ],
  });

  const context = data.context;

  // conditionally apply click or hover interaction
  const click = useClick(context, { enabled: !openOnHover });
  const hover = useHover(context, {
    enabled: openOnHover,
    handleClose: persistOnHoverContent
      ? safePolygon({ blockPointerEvents: true })
      : null,
  });

  const dismiss = useDismiss(context, { bubbles: true });
  const role = useRole(context);

  const interactions = useInteractions([click, hover, dismiss, role]);

  return React.useMemo(
    () => ({
      nodeId,
      parentId,
      open,
      setOpen,
      ...interactions,
      ...data,
      labelId,
      descriptionId,
      setLabelId,
      setDescriptionId,
    }),
    [
      open,
      setOpen,
      interactions,
      data,
      labelId,
      descriptionId,
      nodeId,
      parentId,
    ]
  );
}

type ContextType =
  | (ReturnType<typeof usePopover> & {
      setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>;
      setDescriptionId: React.Dispatch<
        React.SetStateAction<string | undefined>
      >;
    })
  | null;

const PopoverContext = React.createContext<ContextType>(null);

const usePopoverContext = () => {
  const context = React.useContext(PopoverContext);

  if (context == null) {
    throw new Error("Popover components must be wrapped in <Popover />");
  }

  return context;
};

export function Popover({
  children,
  ...restOptions
}: {
  children: React.ReactNode;
} & PopoverOptions) {
  // This can accept any props as options, e.g. `placement`,
  // or other positioning options.
  const popover = usePopover({ ...restOptions });
  return (
    <PopoverContext.Provider value={popover}>
      {children}
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export const PopoverTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLProps<HTMLElement> & PopoverTriggerProps
>(function PopoverTrigger({ children, asChild = false, ...props }, propRef) {
  const context = usePopoverContext();
  // @ts-expect-error nice
  const childrenRef = (children as unknown).ref;
  const ref = useMergeRefs([context.refs.setReference, propRef, childrenRef]);

  const triggerProps = context.getReferenceProps({
    ref,
    ...props,
    // @ts-expect-error nice
    ...(children as unknown)?.props,
    "data-state": context.open ? "open" : "closed",
  });

  const trigger =
    asChild && React.isValidElement(children) ? (
      React.cloneElement(children, triggerProps)
    ) : (
      <button type="button" {...triggerProps}>
        {children}
      </button>
    );

  return (
    // @ts-expect-error nice
    <FloatingNodeContext.Provider value={context.nodeId}>
      {trigger}
    </FloatingNodeContext.Provider>
  );
});

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLProps<HTMLDivElement>
>(function PopoverContent({ style, ...props }, propRef) {
  const { context: floatingContext, ...context } = usePopoverContext();
  const ref = useMergeRefs([context.refs.setFloating, propRef]);

  if (!floatingContext.open) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager context={floatingContext} modal={false}>
        <div
          ref={ref}
          style={{
            ...context.floatingStyles,
            ...style,
            zIndex: 100,
            pointerEvents: "auto",
          }}
          aria-labelledby={context.labelId}
          aria-describedby={context.descriptionId}
          {...context.getFloatingProps(props)}
        >
          {props.children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
});

export const PopoverHeading = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLProps<HTMLHeadingElement>
>(function PopoverHeading(props, ref) {
  const { setLabelId } = usePopoverContext();
  const id = useId();

  // Only sets `aria-labelledby` on the Popover root element
  // if this component is mounted inside it.
  React.useLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [id, setLabelId]);

  return (
    <h2 {...props} ref={ref} id={id}>
      {props.children}
    </h2>
  );
});

export const PopoverDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLProps<HTMLParagraphElement>
>(function PopoverDescription(props, ref) {
  const { setDescriptionId } = usePopoverContext();
  const id = useId();

  // Only sets `aria-describedby` on the Popover root element
  // if this component is mounted inside it.
  React.useLayoutEffect(() => {
    setDescriptionId(id);
    return () => setDescriptionId(undefined);
  }, [id, setDescriptionId]);

  return <p {...props} ref={ref} id={id} />;
});

const FloatingNodeContext = React.createContext<string | null>(null);
