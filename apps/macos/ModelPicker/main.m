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

@interface ProviderSettingsWindowController : NSWindowController <NSSearchFieldDelegate>
- (instancetype)initWithSourceRoot:(NSString *)sourceRoot;
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
@property(nonatomic, strong) NSWindowController *providerSettings;
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
  NSButton *settings = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"gearshape" accessibilityDescription:@"Provider settings"] target:self action:@selector(openProviderSettings:)];
  settings.bezelStyle = NSBezelStyleInline;
  settings.toolTip = @"Provider settings";
  [header addArrangedSubview:settings];
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
- (void)openProviderSettings:(id)sender {
  if (!self.providerSettings) {
    self.providerSettings = [[ProviderSettingsWindowController alloc] initWithSourceRoot:self.sourceRoot];
  }
  [NSApp activateIgnoringOtherApps:YES];
  [self.providerSettings showWindow:nil];
  [self.providerSettings.window makeKeyAndOrderFront:nil];
}
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
    BOOL matchesTab = tab == 0 ? ([visibility isEqual:@"list"] && ([model[@"native"] boolValue] || [model[@"enabled"] boolValue]))
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
  NSString *badge = [self badgeForProvider:provider];
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

- (NSString *)badgeForProvider:(NSString *)provider {
  if ([provider isEqual:@"openai"]) return @"GPT";
  if ([provider isEqual:@"opencode-go"]) return @"GO";
  if ([provider isEqual:@"opencode-free"]) return @"FREE";
  if ([provider isEqual:@"ollama-cloud"]) return @"OLLAMA";
  if ([provider hasSuffix:@"-oauth"]) return @"OAUTH";
  if ([provider containsString:@"plan"] || [provider isEqual:@"zai-coding"]) return @"PLAN";
  NSString *base = [[provider componentsSeparatedByString:@"-"] firstObject].uppercaseString;
  return base.length > 7 ? [base substringToIndex:7] : base;
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

@interface ProviderSettingsWindowController ()
@property(nonatomic, copy) NSString *sourceRoot;
@property(nonatomic, strong) NSArray<NSDictionary *> *providers;
@property(nonatomic, strong) NSDictionary *target;
@property(nonatomic, strong) NSStackView *providerStack;
@property(nonatomic, strong) NSSearchField *searchField;
@property(nonatomic, strong) NSTextField *statusLabel;
@end

@implementation ProviderSettingsWindowController

- (instancetype)initWithSourceRoot:(NSString *)sourceRoot {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 520, 620)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
    backing:NSBackingStoreBuffered defer:NO];
  window.title = @"Model Router · Providers";
  window.minSize = NSMakeSize(480, 500);
  if ((self = [super initWithWindow:window])) {
    self.sourceRoot = sourceRoot;
    [self buildInterface];
    [self refresh];
  }
  return self;
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

- (void)buildInterface {
  NSVisualEffectView *root = [[NSVisualEffectView alloc] init];
  root.material = NSVisualEffectMaterialSidebar;
  root.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  root.state = NSVisualEffectStateActive;
  self.window.contentView = root;
  NSStackView *content = [NSStackView stackViewWithViews:@[]];
  content.orientation = NSUserInterfaceLayoutOrientationVertical;
  content.alignment = NSLayoutAttributeLeading;
  content.spacing = 12;
  content.translatesAutoresizingMaskIntoConstraints = NO;
  [root addSubview:content];
  [NSLayoutConstraint activateConstraints:@[
    [content.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:18],
    [content.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-18],
    [content.topAnchor constraintEqualToAnchor:root.topAnchor constant:18],
    [content.bottomAnchor constraintEqualToAnchor:root.bottomAnchor constant:-16],
  ]];

  [content addArrangedSubview:[self label:@"Providers" size:20 weight:NSFontWeightSemibold color:NSColor.labelColor]];
  NSTextField *intro = [self label:@"Only connected and enabled providers can appear in SOTA. Keys are sent directly to the protected router store." size:10 weight:NSFontWeightRegular color:Muted()];
  intro.maximumNumberOfLines = 2;
  [content addArrangedSubview:intro];
  [intro.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;
  self.searchField = [[NSSearchField alloc] init];
  self.searchField.placeholderString = @"Search providers";
  self.searchField.delegate = self;
  [content addArrangedSubview:self.searchField];
  [self.searchField.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  NSScrollView *scroll = [[NSScrollView alloc] init];
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  self.providerStack = [NSStackView stackViewWithViews:@[]];
  self.providerStack.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.providerStack.alignment = NSLayoutAttributeLeading;
  self.providerStack.spacing = 7;
  self.providerStack.edgeInsets = NSEdgeInsetsMake(2, 0, 6, 6);
  self.providerStack.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.documentView = self.providerStack;
  [self.providerStack.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor].active = YES;
  [content addArrangedSubview:scroll];
  [scroll.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;

  NSStackView *footer = [NSStackView stackViewWithViews:@[]];
  footer.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  self.statusLabel = [self label:@"Loading provider status…" size:9 weight:NSFontWeightRegular color:Muted()];
  [footer addArrangedSubview:self.statusLabel];
  [footer addArrangedSubview:[self spacer]];
  NSButton *refresh = [NSButton buttonWithTitle:@"Refresh" target:self action:@selector(refreshClicked:)];
  refresh.bezelStyle = NSBezelStyleRounded;
  [footer addArrangedSubview:refresh];
  [content addArrangedSubview:footer];
  [footer.widthAnchor constraintEqualToAnchor:content.widthAnchor].active = YES;
}

- (void)controlTextDidChange:(NSNotification *)obj { [self rebuildRows]; }
- (void)refreshClicked:(id)sender { [self refresh]; }

- (NSData *)runControl:(NSArray<NSString *> *)arguments input:(NSData *)input error:(NSError **)error {
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:[self.sourceRoot stringByAppendingPathComponent:@"bin/control"]];
  task.arguments = arguments;
  task.currentDirectoryURL = [NSURL fileURLWithPath:self.sourceRoot];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  NSString *home = NSHomeDirectory();
  environment[@"PATH"] = [NSString stringWithFormat:@"%@/.local/bin:%@/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:%@", home, home, environment[@"PATH"] ?: @""];
  task.environment = environment;
  NSPipe *output = [NSPipe pipe];
  NSPipe *errors = [NSPipe pipe];
  NSPipe *standardInput = input ? [NSPipe pipe] : nil;
  task.standardOutput = output;
  task.standardError = errors;
  task.standardInput = standardInput;
  if (![task launchAndReturnError:error]) return nil;
  if (input) {
    [standardInput.fileHandleForWriting writeData:input];
    [standardInput.fileHandleForWriting closeFile];
  }
  [task waitUntilExit];
  NSData *data = [output.fileHandleForReading readDataToEndOfFile];
  NSData *errorData = [errors.fileHandleForReading readDataToEndOfFile];
  if (task.terminationStatus != 0) {
    NSString *detail = [[NSString alloc] initWithData:errorData encoding:NSUTF8StringEncoding];
    if (error) *error = [NSError errorWithDomain:@"ModelPicker" code:task.terminationStatus userInfo:@{NSLocalizedDescriptionKey:detail.length ? [detail stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"Provider update failed."}];
    return nil;
  }
  return data;
}

- (void)refresh {
  self.statusLabel.stringValue = @"Refreshing provider status…";
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error;
    NSData *providerData = [self runControl:@[@"providers", @"--json"] input:nil error:&error];
    NSDictionary *providerSnapshot = providerData ? [NSJSONSerialization JSONObjectWithData:providerData options:0 error:&error] : nil;
    NSData *targetData = !error ? [self runControl:@[@"--json"] input:nil error:&error] : nil;
    NSDictionary *targetSnapshot = targetData ? [NSJSONSerialization JSONObjectWithData:targetData options:0 error:&error] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (error) {
        self.statusLabel.stringValue = error.localizedDescription;
        return;
      }
      self.providers = providerSnapshot[@"providers"] ?: @[];
      self.target = targetSnapshot[@"targets"][@"codex"] ?: @{};
      [self rebuildRows];
      NSUInteger connected = [[self.providers filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *provider, NSDictionary *_) {
        return [provider[@"configured"] boolValue];
      }]] count];
      self.statusLabel.stringValue = [NSString stringWithFormat:@"%lu connected · changes apply to new tasks", (unsigned long)connected];
    });
  });
}

- (void)rebuildRows {
  for (NSView *view in self.providerStack.arrangedSubviews.copy) {
    [self.providerStack removeArrangedSubview:view];
    [view removeFromSuperview];
  }
  NSString *query = self.searchField.stringValue.lowercaseString;
  NSArray *sorted = [self.providers sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    BOOL lc = [left[@"configured"] boolValue], rc = [right[@"configured"] boolValue];
    if (lc != rc) return lc ? NSOrderedAscending : NSOrderedDescending;
    return [left[@"displayName"] localizedCaseInsensitiveCompare:right[@"displayName"]];
  }];
  NSString *previousSection;
  for (NSDictionary *provider in sorted) {
    NSString *haystack = [NSString stringWithFormat:@"%@ %@", provider[@"displayName"] ?: @"", provider[@"id"] ?: @""];
    if (query.length && [haystack.lowercaseString rangeOfString:query].location == NSNotFound) continue;
    NSString *section = [provider[@"configured"] boolValue] ? @"Connected" : @"Available";
    if (![section isEqual:previousSection]) {
      NSTextField *heading = [self label:section.uppercaseString size:9 weight:NSFontWeightBold color:Muted()];
      [heading.heightAnchor constraintEqualToConstant:20].active = YES;
      [self.providerStack addArrangedSubview:heading];
      [heading.widthAnchor constraintEqualToAnchor:self.providerStack.widthAnchor constant:-6].active = YES;
      previousSection = section;
    }
    NSView *row = [self rowForProvider:provider];
    [self.providerStack addArrangedSubview:row];
    [row.widthAnchor constraintEqualToAnchor:self.providerStack.widthAnchor constant:-6].active = YES;
  }
}

- (NSView *)rowForProvider:(NSDictionary *)provider {
  NSString *providerID = provider[@"id"];
  BOOL configured = [provider[@"configured"] boolValue];
  BOOL enabled = [self.target[@"enabledProviders"] containsObject:providerID];
  NSBox *box = [[NSBox alloc] init];
  box.boxType = NSBoxCustom;
  box.cornerRadius = 10;
  box.fillColor = [NSColor colorWithWhite:1 alpha:0.045];
  box.borderColor = [NSColor colorWithWhite:1 alpha:0.07];
  box.borderWidth = 0.5;
  [box.heightAnchor constraintEqualToConstant:56].active = YES;
  NSStackView *row = [NSStackView stackViewWithViews:@[]];
  row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  row.alignment = NSLayoutAttributeCenterY;
  row.spacing = 10;
  row.translatesAutoresizingMaskIntoConstraints = NO;
  [box addSubview:row];
  [NSLayoutConstraint activateConstraints:@[
    [row.leadingAnchor constraintEqualToAnchor:box.leadingAnchor constant:11],
    [row.trailingAnchor constraintEqualToAnchor:box.trailingAnchor constant:-11],
    [row.centerYAnchor constraintEqualToAnchor:box.centerYAnchor],
  ]];
  NSString *detail = configured ? (enabled ? @"Connected · shown in SOTA when eligible" : @"Connected · hidden from SOTA")
    : [provider[@"kind"] isEqual:@"oauth"] ? @"Sign-in required" : @"API key required";
  NSStackView *labels = [NSStackView stackViewWithViews:@[
    [self label:provider[@"displayName"] ?: providerID size:12 weight:NSFontWeightMedium color:NSColor.labelColor],
    [self label:detail size:9 weight:NSFontWeightRegular color:configured ? Muted() : NSColor.systemOrangeColor],
  ]];
  labels.orientation = NSUserInterfaceLayoutOrientationVertical;
  labels.alignment = NSLayoutAttributeLeading;
  labels.spacing = 3;
  [row addArrangedSubview:labels];
  [row addArrangedSubview:[self spacer]];
  if (configured) {
    ModelButton *toggle = [ModelButton checkboxWithTitle:@"" target:self action:@selector(toggleProvider:)];
    toggle.buttonType = NSButtonTypeSwitch;
    toggle.state = enabled ? NSControlStateValueOn : NSControlStateValueOff;
    toggle.payload = provider;
    [row addArrangedSubview:toggle];
  } else {
    NSString *action = provider[@"action"];
    NSString *title = [action isEqual:@"install"] ? @"Install" : [action isEqual:@"sign-in"] ? @"Sign In" : @"Add Key";
    ModelButton *button = [ModelButton buttonWithTitle:title target:self action:@selector(connectProvider:)];
    button.payload = provider;
    button.bezelStyle = NSBezelStyleRounded;
    button.controlSize = NSControlSizeSmall;
    [row addArrangedSubview:button];
  }
  return box;
}

- (NSString *)selectedProviderID {
  NSString *selected = self.target[@"selectedModel"];
  NSString *alias = self.target[@"nativeAliases"][selected];
  selected = alias ?: selected;
  for (NSDictionary *model in self.target[@"models"] ?: @[]) {
    if ([model[@"slug"] isEqual:selected]) return model[@"provider"];
  }
  return @"openai";
}

- (void)toggleProvider:(ModelButton *)sender {
  NSDictionary *provider = sender.payload;
  NSString *providerID = provider[@"id"];
  BOOL enabling = sender.state == NSControlStateValueOn;
  if (!enabling && [[self selectedProviderID] isEqual:providerID]) {
    sender.state = NSControlStateValueOn;
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Choose a different model first";
    alert.informativeText = @"The provider currently supplies your selected model, so it cannot be disabled safely.";
    [alert runModal];
    return;
  }
  [self applyProvider:providerID enabled:enabling key:nil operation:nil];
}

- (void)connectProvider:(ModelButton *)sender {
  NSDictionary *provider = sender.payload;
  NSString *action = provider[@"action"];
  if ([action isEqual:@"add-key"]) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = [NSString stringWithFormat:@"Connect %@", provider[@"displayName"]];
    alert.informativeText = @"The key is sent through standard input and stored only in the router's protected credential file.";
    NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 360, 26)];
    field.placeholderString = @"API key";
    alert.accessoryView = field;
    [alert addButtonWithTitle:@"Save & Enable"];
    [alert addButtonWithTitle:@"Cancel"];
    if ([alert runModal] != NSAlertFirstButtonReturn) return;
    NSString *key = [field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!key.length) return;
    [self applyProvider:provider[@"id"] enabled:YES key:[key dataUsingEncoding:NSUTF8StringEncoding] operation:@"credential"];
  } else {
    NSString *operation = [action isEqual:@"install"] ? @"install-cli" : @"login";
    [self applyProvider:provider[@"id"] enabled:YES key:nil operation:operation];
  }
}

- (void)applyProvider:(NSString *)providerID enabled:(BOOL)enabled key:(NSData *)key operation:(NSString *)operation {
  self.statusLabel.stringValue = @"Applying provider settings…";
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error;
    if (operation) [self runControl:@[operation, providerID] input:key error:&error];
    if (!error) [self runControl:@[@"set", providerID, enabled ? @"on" : @"off", @"--targets", @"codex"] input:nil error:&error];
    if (!error) [self runControl:@[@"apply", @"--targets", @"codex", @"--activate"] input:nil error:&error];
    dispatch_async(dispatch_get_main_queue(), ^{
      self.statusLabel.stringValue = error ? error.localizedDescription : @"Provider settings applied";
      [self refresh];
    });
  });
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
