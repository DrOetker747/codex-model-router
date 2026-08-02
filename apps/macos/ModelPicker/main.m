#import <Cocoa/Cocoa.h>

static NSColor *Accent(void) { return [NSColor colorWithRed:0.36 green:0.66 blue:0.91 alpha:1]; }
static NSColor *Mint(void) { return [NSColor colorWithRed:0.38 green:0.82 blue:0.61 alpha:1]; }
static NSColor *Purple(void) { return [NSColor colorWithRed:0.71 green:0.48 blue:0.94 alpha:1]; }
static NSColor *Muted(void) { return [NSColor secondaryLabelColor]; }

@interface ModelButton : NSButton
@property(nonatomic, strong) id payload;
@end
@implementation ModelButton
@end

@interface PickerViewController : NSViewController <NSSearchFieldDelegate>
@property(nonatomic, copy) NSString *sourceRoot;
@property(nonatomic, strong) NSArray<NSDictionary *> *models;
@property(nonatomic, strong) NSDictionary *target;
@property(nonatomic, strong) NSMutableArray<NSString *> *favorites;
@property(nonatomic, strong) NSTextField *currentModelLabel;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSSearchField *searchField;
@property(nonatomic, strong) NSSegmentedControl *tabs;
@property(nonatomic, strong) NSStackView *modelStack;
@property(nonatomic, strong) NSProgressIndicator *progress;
@property(nonatomic) BOOL busy;
- (void)refresh;
@end

@implementation PickerViewController

- (void)loadView {
  self.favorites = [[[NSUserDefaults standardUserDefaults] stringArrayForKey:@"ModelPicker.favoriteModels"] mutableCopy]
    ?: [NSMutableArray array];

  NSVisualEffectView *root = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, 404, 620)];
  root.material = NSVisualEffectMaterialPopover;
  root.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  root.state = NSVisualEffectStateActive;
  self.view = root;

  NSStackView *content = [NSStackView stackViewWithViews:@[]];
  content.orientation = NSUserInterfaceLayoutOrientationVertical;
  content.alignment = NSLayoutAttributeLeading;
  content.spacing = 12;
  content.translatesAutoresizingMaskIntoConstraints = NO;
  [root addSubview:content];
  [NSLayoutConstraint activateConstraints:@[
    [content.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:16],
    [content.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-16],
    [content.topAnchor constraintEqualToAnchor:root.topAnchor constant:16],
    [content.bottomAnchor constraintEqualToAnchor:root.bottomAnchor constant:-14],
  ]];

  NSStackView *header = [NSStackView stackViewWithViews:@[]];
  header.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  header.alignment = NSLayoutAttributeCenterY;
  NSTextField *title = [self label:@"Model Router" size:16 weight:NSFontWeightSemibold color:NSColor.labelColor];
  NSTextField *subtitle = [self label:@"Choose a model for your next Codex task" size:10 weight:NSFontWeightRegular color:Muted()];
  NSStackView *titles = [NSStackView stackViewWithViews:@[title, subtitle]];
  titles.orientation = NSUserInterfaceLayoutOrientationVertical;
  titles.alignment = NSLayoutAttributeLeading;
  titles.spacing = 2;
  [header addArrangedSubview:titles];
  [header addArrangedSubview:[self spacer]];
  NSView *dot = [[NSView alloc] init];
  dot.wantsLayer = YES;
  dot.layer.backgroundColor = Mint().CGColor;
  dot.layer.cornerRadius = 4;
  [dot.widthAnchor constraintEqualToConstant:8].active = YES;
  [dot.heightAnchor constraintEqualToConstant:8].active = YES;
  [header addArrangedSubview:dot];
  [header addArrangedSubview:[self label:@"Online" size:10 weight:NSFontWeightMedium color:Muted()]];
  [content addArrangedSubview:header];
  [header.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  NSBox *currentCard = [[NSBox alloc] init];
  currentCard.boxType = NSBoxCustom;
  currentCard.cornerRadius = 12;
  currentCard.fillColor = [NSColor colorWithWhite:1 alpha:0.055];
  currentCard.borderColor = [NSColor colorWithWhite:1 alpha:0.08];
  currentCard.borderWidth = 0.5;
  NSStackView *current = [NSStackView stackViewWithViews:@[]];
  current.orientation = NSUserInterfaceLayoutOrientationVertical;
  current.alignment = NSLayoutAttributeLeading;
  current.spacing = 3;
  current.translatesAutoresizingMaskIntoConstraints = NO;
  [currentCard addSubview:current];
  [NSLayoutConstraint activateConstraints:@[
    [current.leadingAnchor constraintEqualToAnchor:currentCard.leadingAnchor constant:12],
    [current.trailingAnchor constraintEqualToAnchor:currentCard.trailingAnchor constant:-12],
    [current.centerYAnchor constraintEqualToAnchor:currentCard.centerYAnchor],
  ]];
  [current addArrangedSubview:[self label:@"CURRENT MODEL" size:8 weight:NSFontWeightBold color:Muted()]];
  self.currentModelLabel = [self label:@"Loading…" size:14 weight:NSFontWeightSemibold color:NSColor.labelColor];
  self.currentModelLabel.lineBreakMode = NSLineBreakByTruncatingTail;
  [current addArrangedSubview:self.currentModelLabel];
  [currentCard.heightAnchor constraintEqualToConstant:58].active = YES;
  [content addArrangedSubview:currentCard];
  [currentCard.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  self.searchField = [[NSSearchField alloc] init];
  self.searchField.placeholderString = @"Search models";
  self.searchField.delegate = self;
  self.searchField.controlSize = NSControlSizeRegular;
  [self.searchField.heightAnchor constraintEqualToConstant:30].active = YES;
  [content addArrangedSubview:self.searchField];
  [self.searchField.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  self.tabs = [NSSegmentedControl segmentedControlWithLabels:@[@"SOTA", @"OpenCode Go", @"Free"]
    trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(tabChanged:)];
  self.tabs.selectedSegment = 0;
  self.tabs.segmentStyle = NSSegmentStyleTexturedRounded;
  [content addArrangedSubview:self.tabs];
  [self.tabs.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  NSScrollView *scroll = [[NSScrollView alloc] init];
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  self.modelStack = [NSStackView stackViewWithViews:@[]];
  self.modelStack.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.modelStack.alignment = NSLayoutAttributeLeading;
  self.modelStack.spacing = 4;
  self.modelStack.edgeInsets = NSEdgeInsetsMake(2, 0, 4, 5);
  self.modelStack.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.documentView = self.modelStack;
  [self.modelStack.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor].active = YES;
  [content addArrangedSubview:scroll];
  [scroll.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;
  [scroll.heightAnchor constraintGreaterThanOrEqualToConstant:330].active = YES;

  NSStackView *footer = [NSStackView stackViewWithViews:@[]];
  footer.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  footer.alignment = NSLayoutAttributeCenterY;
  self.progress = [[NSProgressIndicator alloc] init];
  self.progress.style = NSProgressIndicatorStyleSpinning;
  self.progress.controlSize = NSControlSizeSmall;
  self.progress.hidden = YES;
  [footer addArrangedSubview:self.progress];
  self.statusLabel = [self label:@"Models are saved for new tasks only" size:9 weight:NSFontWeightRegular color:Muted()];
  self.statusLabel.lineBreakMode = NSLineBreakByTruncatingTail;
  [footer addArrangedSubview:self.statusLabel];
  [footer addArrangedSubview:[self spacer]];
  NSButton *refresh = [NSButton buttonWithTitle:@"Refresh" target:self action:@selector(refreshClicked:)];
  refresh.bezelStyle = NSBezelStyleInline;
  [footer addArrangedSubview:refresh];
  [content addArrangedSubview:footer];
  [footer.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;
}

- (NSTextField *)label:(NSString *)text size:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor *)color {
  NSTextField *label = [NSTextField labelWithString:text];
  label.font = [NSFont systemFontOfSize:size weight:weight];
  label.textColor = color;
  return label;
}

- (NSView *)spacer {
  NSView *view = [[NSView alloc] init];
  [view setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [view setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  return view;
}

- (void)viewDidAppear {
  [super viewDidAppear];
  [self refresh];
}

- (void)refreshClicked:(id)sender { [self refresh]; }
- (void)tabChanged:(id)sender { [self rebuildRows]; }
- (void)controlTextDidChange:(NSNotification *)obj { [self rebuildRows]; }

- (void)setBusy:(BOOL)busy message:(NSString *)message {
  self.busy = busy;
  self.tabs.enabled = !busy;
  self.searchField.enabled = !busy;
  self.progress.hidden = !busy;
  busy ? [self.progress startAnimation:nil] : [self.progress stopAnimation:nil];
  if (message.length) self.statusLabel.stringValue = message;
}

- (NSData *)runControl:(NSArray<NSString *> *)arguments error:(NSError **)error {
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:[self.sourceRoot stringByAppendingPathComponent:@"bin/control"]];
  task.arguments = arguments;
  task.currentDirectoryURL = [NSURL fileURLWithPath:self.sourceRoot];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  NSString *home = NSHomeDirectory();
  NSString *path = environment[@"PATH"] ?: @"";
  environment[@"PATH"] = [NSString stringWithFormat:@"%@/.local/bin:%@/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:%@", home, home, path];
  task.environment = environment;
  NSPipe *output = [NSPipe pipe];
  NSPipe *errors = [NSPipe pipe];
  task.standardOutput = output;
  task.standardError = errors;
  if (![task launchAndReturnError:error]) return nil;
  [task waitUntilExit];
  NSData *data = [output.fileHandleForReading readDataToEndOfFile];
  NSData *errorData = [errors.fileHandleForReading readDataToEndOfFile];
  if (task.terminationStatus != 0) {
    NSString *detail = [[NSString alloc] initWithData:errorData encoding:NSUTF8StringEncoding];
    if (error) *error = [NSError errorWithDomain:@"ModelPicker" code:task.terminationStatus
      userInfo:@{NSLocalizedDescriptionKey: detail.length ? [detail stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"Model Router command failed."}];
    return nil;
  }
  return data;
}

- (void)refresh {
  if (self.busy) return;
  [self setBusy:YES message:@"Refreshing model catalog…"];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error;
    NSData *data = [self runControl:@[@"--json"] error:&error];
    NSDictionary *snapshot = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&error] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!snapshot) {
        [self setBusy:NO message:error.localizedDescription ?: @"Router unavailable"];
        return;
      }
      self.target = snapshot[@"targets"][@"codex"];
      self.models = [self uniqueModels:self.target[@"models"] ?: @[]];
      [self updateCurrentModel];
      [self rebuildRows];
      [self setBusy:NO message:[NSString stringWithFormat:@"%lu models available", (unsigned long)self.models.count]];
    });
  });
}

- (NSArray<NSDictionary *> *)uniqueModels:(NSArray *)models {
  NSMutableSet *seen = [NSMutableSet set];
  NSMutableArray *result = [NSMutableArray array];
  for (NSDictionary *model in models) {
    NSString *slug = model[@"slug"];
    if (slug.length && ![seen containsObject:slug]) {
      [seen addObject:slug];
      [result addObject:model];
    }
  }
  return result;
}

- (NSString *)selectedSlug {
  NSString *selected = self.target[@"selectedModel"];
  NSString *alias = self.target[@"nativeAliases"][selected];
  return alias ?: selected;
}

- (void)updateCurrentModel {
  NSString *selected = [self selectedSlug];
  NSDictionary *model = [self.models filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *item, NSDictionary *_) {
    return [item[@"slug"] isEqual:selected];
  }]].firstObject;
  self.currentModelLabel.stringValue = model[@"displayName"] ?: selected ?: @"Choose a model";
}

- (NSArray<NSDictionary *> *)visibleModels {
  NSInteger tab = self.tabs.selectedSegment;
  NSString *query = self.searchField.stringValue.lowercaseString;
  NSMutableArray *visible = [NSMutableArray array];
  for (NSDictionary *model in self.models) {
    NSString *provider = model[@"provider"] ?: @"";
    NSString *visibility = model[@"pickerVisibility"] ?: @"list";
    BOOL matchesTab = tab == 0 ? [visibility isEqual:@"list"]
      : tab == 1 ? [provider isEqual:@"opencode-go"]
      : [provider isEqual:@"opencode-free"];
    if (!matchesTab) continue;
    NSString *haystack = [NSString stringWithFormat:@"%@ %@ %@ %@", model[@"displayName"] ?: @"", model[@"slug"] ?: @"", provider, model[@"family"] ?: @""];
    if (query.length && [haystack.lowercaseString rangeOfString:query].location == NSNotFound) continue;
    [visible addObject:model];
  }
  [visible sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    NSUInteger lf = [self.favorites indexOfObject:left[@"slug"]];
    NSUInteger rf = [self.favorites indexOfObject:right[@"slug"]];
    if (lf != NSNotFound || rf != NSNotFound) {
      if (lf == NSNotFound) return NSOrderedDescending;
      if (rf == NSNotFound) return NSOrderedAscending;
      if (lf != rf) return lf < rf ? NSOrderedAscending : NSOrderedDescending;
    }
    NSString *a = [NSString stringWithFormat:@"%@ %@", left[@"family"] ?: @"Other", left[@"displayName"] ?: @""];
    NSString *b = [NSString stringWithFormat:@"%@ %@", right[@"family"] ?: @"Other", right[@"displayName"] ?: @""];
    return [a localizedCaseInsensitiveCompare:b];
  }];
  return visible;
}

- (void)rebuildRows {
  for (NSView *view in self.modelStack.arrangedSubviews.copy) {
    [self.modelStack removeArrangedSubview:view];
    [view removeFromSuperview];
  }
  NSArray *visible = [self visibleModels];
  if (!visible.count) {
    NSTextField *empty = [self label:@"No matching models" size:11 weight:NSFontWeightMedium color:Muted()];
    empty.alignment = NSTextAlignmentCenter;
    [empty.heightAnchor constraintEqualToConstant:80].active = YES;
    [self.modelStack addArrangedSubview:empty];
    [empty.widthAnchor constraintEqualToAnchor:self.modelStack.widthAnchor constant:-5].active = YES;
    return;
  }
  NSString *previousFamily;
  for (NSDictionary *model in visible) {
    NSString *slug = model[@"slug"];
    NSString *family = [self.favorites containsObject:slug] ? @"Favorites" : (model[@"family"] ?: @"Other");
    if (![family isEqual:previousFamily]) {
      NSTextField *heading = [self label:family.uppercaseString size:8 weight:NSFontWeightBold color:Muted()];
      [heading.heightAnchor constraintEqualToConstant:16].active = YES;
      [self.modelStack addArrangedSubview:heading];
      [heading.widthAnchor constraintEqualToAnchor:self.modelStack.widthAnchor constant:-5].active = YES;
      previousFamily = family;
    }
    NSView *row = [self rowForModel:model];
    [self.modelStack addArrangedSubview:row];
    [row.widthAnchor constraintEqualToAnchor:self.modelStack.widthAnchor constant:-5].active = YES;
  }
}

- (NSView *)rowForModel:(NSDictionary *)model {
  NSString *slug = model[@"slug"] ?: @"";
  BOOL selected = [slug isEqual:[self selectedSlug]] || [slug isEqual:self.target[@"selectedModel"]];
  NSBox *box = [[NSBox alloc] init];
  box.boxType = NSBoxCustom;
  box.cornerRadius = 9;
  box.fillColor = selected ? [Accent() colorWithAlphaComponent:0.13] : NSColor.clearColor;
  box.borderWidth = 0;
  [box.heightAnchor constraintEqualToConstant:44].active = YES;
  NSStackView *row = [NSStackView stackViewWithViews:@[]];
  row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  row.alignment = NSLayoutAttributeCenterY;
  row.spacing = 9;
  row.translatesAutoresizingMaskIntoConstraints = NO;
  [box addSubview:row];
  [NSLayoutConstraint activateConstraints:@[
    [row.leadingAnchor constraintEqualToAnchor:box.leadingAnchor constant:8],
    [row.trailingAnchor constraintEqualToAnchor:box.trailingAnchor constant:-8],
    [row.centerYAnchor constraintEqualToAnchor:box.centerYAnchor],
  ]];
  ModelButton *choose = [ModelButton buttonWithTitle:model[@"displayName"] ?: slug target:self action:@selector(modelClicked:)];
  choose.payload = model;
  choose.bezelStyle = NSBezelStyleInline;
  choose.font = [NSFont systemFontOfSize:11 weight:selected ? NSFontWeightSemibold : NSFontWeightMedium];
  choose.alignment = NSTextAlignmentLeft;
  choose.lineBreakMode = NSLineBreakByTruncatingTail;
  choose.toolTip = slug;
  [row addArrangedSubview:choose];
  [choose setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [row addArrangedSubview:[self spacer]];
  NSString *provider = model[@"provider"] ?: @"";
  NSString *badge = [provider isEqual:@"opencode-free"] ? @"FREE" : [provider isEqual:@"openai"] ? @"GPT" : @"GO";
  NSTextField *badgeLabel = [self label:badge size:8 weight:NSFontWeightBold color:[provider isEqual:@"opencode-free"] ? Mint() : [provider isEqual:@"openai"] ? Accent() : Purple()];
  [row addArrangedSubview:badgeLabel];
  ModelButton *star = [ModelButton buttonWithImage:[NSImage imageWithSystemSymbolName:[self.favorites containsObject:slug] ? @"star.fill" : @"star" accessibilityDescription:@"Favorite"] target:self action:@selector(favoriteClicked:)];
  star.payload = slug;
  star.bezelStyle = NSBezelStyleInline;
  star.contentTintColor = [self.favorites containsObject:slug] ? [NSColor systemYellowColor] : Muted();
  [row addArrangedSubview:star];
  if (selected) {
    NSImageView *check = [[NSImageView alloc] init];
    check.image = [NSImage imageWithSystemSymbolName:@"checkmark.circle.fill" accessibilityDescription:@"Selected"];
    check.contentTintColor = Mint();
    [row addArrangedSubview:check];
  }
  return box;
}

- (void)favoriteClicked:(ModelButton *)sender {
  NSString *slug = sender.payload;
  if ([self.favorites containsObject:slug]) [self.favorites removeObject:slug];
  else [self.favorites addObject:slug];
  [[NSUserDefaults standardUserDefaults] setObject:self.favorites forKey:@"ModelPicker.favoriteModels"];
  [self rebuildRows];
}

- (void)modelClicked:(ModelButton *)sender {
  if (self.busy) return;
  NSDictionary *model = sender.payload;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = [NSString stringWithFormat:@"Use %@ for new Codex tasks?", model[@"displayName"] ?: model[@"slug"]];
  alert.informativeText = @"The running task stays unchanged. Restart only if you want the new model immediately.";
  [alert addButtonWithTitle:@"Save for later"];
  [alert addButtonWithTitle:@"Restart Codex now"];
  [alert addButtonWithTitle:@"Cancel"];
  NSModalResponse response = [alert runModal];
  if (response == NSAlertThirdButtonReturn) return;
  [self selectModel:model restart:response == NSAlertSecondButtonReturn];
}

- (void)selectModel:(NSDictionary *)model restart:(BOOL)restart {
  NSString *slug = model[@"slug"];
  [self setBusy:YES message:@"Saving selected model…"];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error;
    [self runControl:@[@"model-set", slug] error:&error];
    if (!error && restart) [self restartCodex:&error];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (error) {
        [self setBusy:NO message:error.localizedDescription];
      } else {
        [self setBusy:NO message:restart ? @"Codex restarted with the selected model" : @"Saved for the next Codex task"];
        [self refresh];
      }
    });
  });
}

- (void)restartCodex:(NSError **)error {
  NSString *bundleID = @"com.openai.codex";
  NSArray<NSRunningApplication *> *running = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID];
  NSURL *url = running.firstObject.bundleURL ?: [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:bundleID];
  if (!url) {
    if (error) *error = [NSError errorWithDomain:@"ModelPicker" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Codex desktop app was not found."}];
    return;
  }
  for (NSRunningApplication *app in running) {
    if (!app.terminated && ![app terminate]) {
      if (error) *error = [NSError errorWithDomain:@"ModelPicker" code:2 userInfo:@{NSLocalizedDescriptionKey:@"Codex did not accept a graceful quit request."}];
      return;
    }
  }
  for (NSInteger attempt = 0; attempt < 50 && [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID].count != 0; attempt++) {
    [NSThread sleepForTimeInterval:0.1];
  }
  if ([NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID].count) {
    if (error) *error = [NSError errorWithDomain:@"ModelPicker" code:3 userInfo:@{NSLocalizedDescriptionKey:@"Codex did not quit in time. Restart it manually."}];
    return;
  }
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block NSError *openError;
  NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
  configuration.activates = YES;
  [[NSWorkspace sharedWorkspace] openApplicationAtURL:url configuration:configuration completionHandler:^(NSRunningApplication *app, NSError *resultError) {
    openError = resultError;
    dispatch_semaphore_signal(semaphore);
  }];
  dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
  if (openError && error) *error = openError;
}

@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSPopover *popover;
@property(nonatomic, strong) PickerViewController *picker;
@end

@implementation AppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.button.image = [NSImage imageWithSystemSymbolName:@"point.3.connected.trianglepath.dotted" accessibilityDescription:@"Model Picker"];
  self.statusItem.button.toolTip = @"Codex Model Picker";
  self.statusItem.button.target = self;
  self.statusItem.button.action = @selector(togglePopover:);
  self.picker = [[PickerViewController alloc] init];
  NSURL *marker = [NSBundle.mainBundle URLForResource:@"router-root" withExtension:nil];
  self.picker.sourceRoot = marker ? [[[NSString alloc] initWithContentsOfURL:marker encoding:NSUTF8StringEncoding error:nil] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : NSFileManager.defaultManager.currentDirectoryPath;
  self.popover = [[NSPopover alloc] init];
  self.popover.contentSize = NSMakeSize(404, 620);
  self.popover.behavior = NSPopoverBehaviorTransient;
  self.popover.animates = YES;
  self.popover.contentViewController = self.picker;
}
- (void)togglePopover:(id)sender {
  if (self.popover.shown) [self.popover performClose:nil];
  else {
    [self.popover showRelativeToRect:self.statusItem.button.bounds ofView:self.statusItem.button preferredEdge:NSRectEdgeMinY];
    [self.picker refresh];
  }
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *application = NSApplication.sharedApplication;
    AppDelegate *delegate = [[AppDelegate alloc] init];
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
